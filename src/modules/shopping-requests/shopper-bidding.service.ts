import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ShopperAccountState } from '@prisma/client';
import {
  DuplicateActiveOfferError,
  IShopperProfileRepository,
  IShoppingFeeRules,
  IShoppingOfferRepository,
  IShoppingRequestRepository,
  OfferRequestClosedError,
  ShopperBarredFromRequestError,
  SHOPPER_PROFILE_REPOSITORY,
  SHOPPING_OFFER_REPOSITORY,
  SHOPPING_REQUEST_REPOSITORY,
  ShopperProfileWithDetails,
  ShoppingRequestWithItems,
} from '@/database/repositories';
import { EVENTS } from '@common/constants';
import { ShoppingOfferSubmittedEvent } from '@common/events';
import {
  ConflictException,
  ForbiddenException,
  ValidationException,
} from '@common/exceptions/base.exception';
import { ResourceNotFoundException } from '@common/exceptions/domain.exception';
import { IPaginatedResult } from '@common/interfaces';
import { createPaginationMeta } from '@common/utils/pagination.util';
import { AuditService } from '@common/services/audit.service';
import {
  OfferInputDto,
  ShopperOfferQueryDto,
  ShopperOfferResponseDto,
  ShopperOfferWithRequestResponseDto,
  ShopperRequestDetailResponseDto,
  ShopperRequestQueryDto,
  ShopperRequestSummaryResponseDto,
} from './dto';
import { ShoppingConfigService } from './shopping-config.service';
import { calculateOfferBreakdown } from './shopping-pricing';
import {
  toShopperDetail,
  toShopperOffer,
  toShopperOfferWithRequest,
  toShopperSummary,
} from './shopping.mapper';

const BARRED_MESSAGE =
  'You can no longer bid on this request because your earlier order on it was cancelled';

@Injectable()
export class ShopperBiddingService {
  private readonly logger = new Logger(ShopperBiddingService.name);

  constructor(
    @Inject(SHOPPER_PROFILE_REPOSITORY) private readonly profiles: IShopperProfileRepository,
    @Inject(SHOPPING_REQUEST_REPOSITORY) private readonly requests: IShoppingRequestRepository,
    @Inject(SHOPPING_OFFER_REPOSITORY) private readonly offers: IShoppingOfferRepository,
    private readonly config: ShoppingConfigService,
    private readonly events: EventEmitter2,
    private readonly audit: AuditService,
  ) {}

  // --------------------------------------------------------------------- feed

  /**
   * The marketplace. Matching is entirely server-side (see shopperMatchWhere):
   * an offline shopper simply sees nothing, as the spec's "visible only to
   * shoppers who are approved, online, ..." requires.
   */
  async feed(
    userId: string,
    query: ShopperRequestQueryDto,
  ): Promise<IPaginatedResult<ShopperRequestSummaryResponseDto>> {
    const profile = await this.approvedProfile(userId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    if (!profile.isOnline) {
      return { data: [], meta: createPaginationMeta(page, limit, 0) };
    }

    const rules = await this.config.getRules();
    const { rows, total } = await this.requests.findMatchingForShopper({
      shopperProfileId: profile.id,
      now: new Date(),
      locationId: query.locationId,
      categoryId: query.categoryId,
      sortBy: query.sortBy ?? 'createdAt',
      sortOrder: query.sortOrder === 'ASC' ? 'asc' : 'desc',
      skip: (page - 1) * limit,
      take: limit,
    });
    const submitted = await this.offers.findPendingRequestIds(
      profile.id,
      rows.map((row) => row.id),
    );
    return {
      data: rows.map((row) => toShopperSummary(row, rules, submitted.has(row.id))),
      meta: createPaginationMeta(page, limit, total),
    };
  }

  /**
   * One request. Readable while it matches the shopper, and afterwards for any
   * request they bid on. Anything else is 404 rather than 403: a request that
   * is not for this shopper might as well not exist.
   */
  async getRequest(userId: string, id: string): Promise<ShopperRequestDetailResponseDto> {
    const profile = await this.approvedProfile(userId);
    const request = await this.requests.findReadableByShopper(id, profile.id, new Date());
    if (!request) {
      throw new ResourceNotFoundException('Shopping request', id);
    }
    await this.offers.expireDue(new Date(), { requestId: id, shopperProfileId: profile.id });
    const [rules, myOffer] = await Promise.all([
      this.config.getRules(),
      this.offers.findPendingByShopperAndRequest(profile.id, id),
    ]);
    return toShopperDetail(request, rules, myOffer ?? undefined);
  }

  // ------------------------------------------------------------------- offers

  /** What the offer would look like, with nothing written. Safe to call on every keystroke. */
  async preview(
    userId: string,
    requestId: string,
    dto: OfferInputDto,
  ): Promise<ShopperOfferResponseDto> {
    const { profile, request, rules } = await this.biddingContext(userId, requestId, dto);
    const financials = calculateOfferBreakdown(request.estimatedGoodsBudget, dto.shopperFee, rules);
    return toShopperOffer(
      {
        requestId,
        shopperProfileId: profile.id,
        state: 'PENDING',
        shopperFee: dto.shopperFee,
        etaMinutes: dto.etaMinutes,
        note: dto.note ?? null,
        // Valid until the end of the ACCEPTANCE window, which outlives the bidding deadline.
        expiresAt: new Date(
          request.offerDeadline.getTime() + rules.offerAcceptanceWindowMinutes * 60_000,
        ),
      },
      financials,
    );
  }

  /**
   * Submit the bid. One active (PENDING) offer per shopper per request: a
   * second submit is a 409, not a replacement; withdraw first to bid again.
   */
  async submit(
    userId: string,
    requestId: string,
    dto: OfferInputDto,
  ): Promise<ShopperOfferResponseDto> {
    const { profile, request, rules } = await this.biddingContext(userId, requestId, dto);
    const financials = calculateOfferBreakdown(request.estimatedGoodsBudget, dto.shopperFee, rules);

    let offer;
    try {
      offer = await this.offers.submit({
        requestId,
        shopperProfileId: profile.id,
        shopperFee: dto.shopperFee,
        etaMinutes: dto.etaMinutes,
        note: dto.note,
        financials: { ...financials },
        acceptanceWindowMinutes: rules.offerAcceptanceWindowMinutes,
      });
    } catch (error) {
      // Re-checked under the repository's row lock / unique index, so these
      // are final even when the reads above were stale.
      if (error instanceof OfferRequestClosedError) {
        throw new ConflictException('This request is no longer open for offers');
      }
      if (error instanceof ShopperBarredFromRequestError) {
        throw new ConflictException(BARRED_MESSAGE);
      }
      if (error instanceof DuplicateActiveOfferError) {
        throw new ConflictException(
          'You already have an active offer on this request; withdraw it to submit a new one',
        );
      }
      throw error;
    }

    await this.record(userId, 'SHOPPING_OFFER_SUBMITTED', offer.id, {
      requestId,
      shopperFee: dto.shopperFee,
    });
    this.events.emit(
      EVENTS.SHOPPING_OFFER_SUBMITTED,
      new ShoppingOfferSubmittedEvent(
        request.customerId,
        requestId,
        request.reference,
        offer.id,
        profile.displayName ?? 'A shopper',
        offer.shopperFee,
        financials.customerTotal,
      ),
    );
    return toShopperOffer(offer, financials);
  }

  async listOffers(
    userId: string,
    query: ShopperOfferQueryDto,
  ): Promise<IPaginatedResult<ShopperOfferWithRequestResponseDto>> {
    const profile = await this.approvedProfile(userId);
    await this.offers.expireDue(new Date(), { shopperProfileId: profile.id });
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const [rules, { rows, total }] = await Promise.all([
      this.config.getRules(),
      this.offers.listForShopper(profile.id, (page - 1) * limit, limit, query.state),
    ]);
    const pending = await this.offers.findPendingRequestIds(
      profile.id,
      rows.map((row) => row.requestId),
    );
    return {
      data: rows.map((row) => toShopperOfferWithRequest(row, rules, pending.has(row.requestId))),
      meta: createPaginationMeta(page, limit, total),
    };
  }

  async getOffer(userId: string, id: string): Promise<ShopperOfferWithRequestResponseDto> {
    const profile = await this.approvedProfile(userId);
    await this.offers.expireDue(new Date(), { shopperProfileId: profile.id });
    const offer = await this.offers.findOwnedById(id, profile.id);
    if (!offer) {
      throw new ResourceNotFoundException('Offer', id);
    }
    return toShopperOfferWithRequest(
      offer,
      await this.config.getRules(),
      await this.hasPending(profile.id, offer.requestId),
    );
  }

  /** Withdraw an own PENDING offer. The state check is part of the UPDATE. */
  async withdraw(userId: string, id: string): Promise<ShopperOfferWithRequestResponseDto> {
    const profile = await this.approvedProfile(userId);
    await this.offers.expireDue(new Date(), { shopperProfileId: profile.id });
    const withdrawn = await this.offers.withdraw(id, profile.id);
    const offer = await this.offers.findOwnedById(id, profile.id);
    if (!offer) {
      throw new ResourceNotFoundException('Offer', id);
    }
    if (!withdrawn) {
      throw new ConflictException(
        `Only a pending offer can be withdrawn; this one is ${offer.state.toLowerCase()}`,
      );
    }
    await this.record(userId, 'SHOPPING_OFFER_WITHDRAWN', id, { requestId: offer.requestId });
    return toShopperOfferWithRequest(
      offer,
      await this.config.getRules(),
      await this.hasPending(profile.id, offer.requestId),
    );
  }

  // ------------------------------------------------------------------ helpers

  private async hasPending(shopperProfileId: string, requestId: string): Promise<boolean> {
    return (await this.offers.findPendingByShopperAndRequest(shopperProfileId, requestId)) !== null;
  }

  /** 403 unless APPROVED. */
  private async approvedProfile(userId: string): Promise<ShopperProfileWithDetails> {
    const profile = await this.profiles.ensureByUserId(userId);
    if (profile.accountState !== ShopperAccountState.APPROVED) {
      throw new ForbiddenException('Only an approved shopper can use the request marketplace');
    }
    return profile;
  }

  /**
   * Everything preview and submit share, in the order the errors are decided:
   * 403 not approved or offline, 404 not a request for this shopper, 409 closed,
   * 422 fee outside the configured bounds.
   */
  private async biddingContext(
    userId: string,
    requestId: string,
    dto: OfferInputDto,
  ): Promise<{
    profile: ShopperProfileWithDetails;
    request: ShoppingRequestWithItems;
    rules: IShoppingFeeRules;
  }> {
    const profile = await this.approvedProfile(userId);
    if (!profile.isOnline) {
      throw new ForbiddenException('Go online to submit offers');
    }
    const request = await this.requests.findCoveredByShopper(requestId, profile.id);
    if (!request) {
      throw new ResourceNotFoundException('Shopping request', requestId);
    }
    // The bidding deadline closes bidding for new offers and previews alike.
    if (request.status !== 'OPEN' || request.offerDeadline.getTime() <= Date.now()) {
      throw new ConflictException('This request is no longer open for offers');
    }
    // Cancelled out of this request: no second go at it, previews included.
    if (await this.requests.isShopperBarred(requestId, profile.id)) {
      throw new ConflictException(BARRED_MESSAGE);
    }

    const rules = await this.config.getRules();
    if (dto.shopperFee < rules.minShopperFee || dto.shopperFee > rules.maxShopperFee) {
      throw new ValidationException(
        [
          {
            field: 'shopperFee',
            message: `shopperFee must be between ${rules.minShopperFee} and ${rules.maxShopperFee}`,
          },
        ],
        'Shopper fee is outside the allowed range',
      );
    }
    return { profile, request, rules };
  }

  private async record(
    userId: string,
    action: string,
    entityId: string,
    details: Record<string, string | number>,
  ): Promise<void> {
    try {
      await this.audit.log({ userId, action, entity: 'ShoppingOffer', entityId, details });
    } catch (error) {
      this.logger.error(`Failed to record ${action} for offer ${entityId}: ${error}`);
    }
  }
}
