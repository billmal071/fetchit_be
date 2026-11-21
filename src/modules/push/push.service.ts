import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import * as webpush from 'web-push';
import { BadRequestException, UnauthorizedException } from '@/common/exceptions';
import { isAllowedPushEndpoint } from '@/common/utils/push-endpoint.util';
import { IPushConfig } from '@/config';
import { IPushSubscriptionRepository, PUSH_SUBSCRIPTION_REPOSITORY } from '@/database/repositories';
import { PushConfigResponseDto, SubscribePushDto, UnsubscribePushDto } from './dto';

/** Payload the service worker receives as JSON. */
export interface IPushPayload {
  title: string;
  body: string;
  /** In-app path to open on click, e.g. /shopper/onboarding */
  url: string;
  tag: string;
}

@Injectable()
export class PushService {
  /** Abort a hung push service instead of tying up a worker. */
  static readonly SEND_TIMEOUT_MS = 10_000;
  static readonly SEND_TTL_SECONDS = 60 * 60 * 24;

  private readonly allowedHosts: string[];
  private readonly logger = new Logger(PushService.name);
  private readonly vapid: { subject: string; publicKey: string; privateKey: string } | null;

  constructor(
    @Inject(PUSH_SUBSCRIPTION_REPOSITORY)
    private readonly subscriptions: IPushSubscriptionRepository,
    configService: ConfigService,
  ) {
    const cfg = configService.get<IPushConfig>('push');
    this.allowedHosts = cfg?.allowedHosts ?? [];
    const values = [cfg?.vapidPublicKey, cfg?.vapidPrivateKey, cfg?.vapidSubject];
    const setCount = values.filter(Boolean).length;

    if (setCount === 0) {
      this.vapid = null;
    } else if (setCount < 3 || !cfg) {
      this.logger.warn(
        'Web Push is DISABLED: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT must all be set.',
      );
      this.vapid = null;
    } else {
      try {
        // Throws on a malformed subject or key; we validate once at boot.
        webpush.setVapidDetails(cfg.vapidSubject, cfg.vapidPublicKey, cfg.vapidPrivateKey);
        this.vapid = {
          subject: cfg.vapidSubject,
          publicKey: cfg.vapidPublicKey,
          privateKey: cfg.vapidPrivateKey,
        };
      } catch (error) {
        this.logger.warn(
          `Web Push is DISABLED: invalid VAPID configuration (${error instanceof Error ? error.message : error}).`,
        );
        this.vapid = null;
      }
    }
  }

  get enabled(): boolean {
    return this.vapid !== null;
  }

  getConfig(): PushConfigResponseDto {
    return { enabled: this.enabled, publicKey: this.vapid?.publicKey ?? null };
  }

  async subscribe(userId: string, dto: SubscribePushDto): Promise<void> {
    if (!isAllowedPushEndpoint(dto.endpoint, this.allowedHosts)) {
      throw new BadRequestException('endpoint is not an allowed push service URL');
    }
    try {
      await this.subscriptions.upsertByEndpoint({
        userId,
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        userAgent: dto.userAgent ?? null,
      });
    } catch (error) {
      // FK violation: the user was deleted between auth and insert.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new UnauthorizedException('User no longer exists');
      }
      throw error;
    }
  }

  /** Idempotent; only ever removes the caller's own subscription. */
  async unsubscribe(userId: string, dto: UnsubscribePushDto): Promise<void> {
    await this.subscriptions.deleteByEndpointForUser(dto.endpoint, userId);
  }

  /**
   * Best-effort delivery to every subscription of a user. Never throws:
   * a notification is never worth failing the business action that caused it.
   */
  async sendToUser(userId: string, payload: IPushPayload): Promise<void> {
    if (!this.vapid) return;

    try {
      const subs = await this.subscriptions.findByUserId(userId);
      if (subs.length === 0) return;

      const body = JSON.stringify(payload);
      const vapidDetails = this.vapid;

      await Promise.all(
        subs.map(async (sub) => {
          // Rows stored before the allowlist existed (or after it changed).
          if (!isAllowedPushEndpoint(sub.endpoint, this.allowedHosts)) {
            this.logger.warn(
              `Deleting push subscription ${sub.id} for user ${userId}: endpoint host not allowed`,
            );
            await this.subscriptions.deleteById(sub.id).catch((e) => this.logFailure(userId, e));
            return;
          }
          try {
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              body,
              {
                vapidDetails,
                TTL: PushService.SEND_TTL_SECONDS,
                timeout: PushService.SEND_TIMEOUT_MS,
              },
            );
            await this.subscriptions.markUsed(sub.id);
          } catch (error) {
            const status = (error as { statusCode?: number })?.statusCode;
            if (status === 404 || status === 410) {
              // Subscription is permanently gone (user revoked / expired).
              await this.subscriptions.deleteById(sub.id).catch((e) => this.logFailure(userId, e));
              return;
            }
            if (status === undefined && PushService.isKeyError(error)) {
              // Stored keys can never encrypt a payload; retrying is pointless.
              this.logger.warn(
                `Deleting push subscription ${sub.id} for user ${userId}: invalid keys (${(error as Error).message})`,
              );
              await this.subscriptions.deleteById(sub.id).catch((e) => this.logFailure(userId, e));
              return;
            }
            this.logFailure(userId, error);
          }
        }),
      );
    } catch (error) {
      this.logFailure(userId, error);
    }
  }

  /** web-push throws plain Errors (no statusCode) for malformed p256dh/auth. */
  private static isKeyError(error: unknown): boolean {
    return (
      error instanceof Error &&
      /p256dh|auth (key|secret)|public key|subscription.*\bkeys?\b|encrypt/i.test(error.message)
    );
  }

  private logFailure(userId: string, error: unknown): void {
    this.logger.warn(
      `Push delivery failed for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
