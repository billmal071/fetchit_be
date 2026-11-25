import { PushSubscription } from '@prisma/client';

export interface IUpsertPushSubscription {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}

/**
 * Push Subscription Repository Interface
 *
 * One row per browser/device endpoint. `endpoint` is globally unique: the same
 * browser profile re-subscribing after another account signed in on it must
 * move the row to the new user rather than fail or duplicate.
 */
export interface IPushSubscriptionRepository {
  /**
   * Create or update by endpoint. If the endpoint already belongs to another
   * user it is reassigned to `data.userId`.
   */
  upsertByEndpoint(data: IUpsertPushSubscription): Promise<PushSubscription>;

  findByUserId(userId: string): Promise<PushSubscription[]>;

  /**
   * Delete the caller's own subscription. Scoped by userId so one user cannot
   * remove another's. Returns how many rows were removed (0 when absent).
   */
  deleteByEndpointForUser(endpoint: string, userId: string): Promise<number>;

  /** Delete by primary key (used when the push service reports it gone). */
  deleteById(id: string): Promise<void>;

  /** Record a successful delivery. */
  markUsed(id: string): Promise<void>;
}

export const PUSH_SUBSCRIPTION_REPOSITORY = Symbol('PUSH_SUBSCRIPTION_REPOSITORY');
