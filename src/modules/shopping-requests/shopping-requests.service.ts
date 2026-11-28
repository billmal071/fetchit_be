import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  IShoppingOfferRepository,
  IShoppingRequestRepository,
  IShoppingReferenceRepository,
  SHOPPING_OFFER_REPOSITORY,
  SHOPPING_REFERENCE_REPOSITORY,
  SHOPPING_REQUEST_REPOSITORY,
} from '@/database/repositories';
import {
  BadRequestException,
  ConflictException,
  ValidationException,
} from '@common/exceptions/base.exception';
import { ResourceNotFoundException } from '@common/exceptions/domain.exception';
import { IPaginatedResult } from '@common/interfaces';
import { createPaginationMeta } from '@common/utils/pagination.util';
import { AuditService } from '@common/services/audit.service';
import {
  CreateShoppingRequestDto,
  ShoppingRequestDetailResponseDto,
  ShoppingRequestQueryDto,
  ShoppingRequestResponseDto,
} from './dto';
import { ShoppingConfigService } from './shopping-config.service';
import { MAX_AMOUNT, calculateEstimate, goodsBudget } from './shopping-pricing';
import { toRequestDetail, toRequestResponse } from './shopping.mapper';

@Injectable()
export class ShoppingRequestsService {
  private readonly logger = new Logger(ShoppingRequestsService.name);

  constructor(
    @Inject(SHOPPING_REQUEST_REPOSITORY) private readonly requests: IShoppingRequestRepository,
    @Inject(SHOPPING_OFFER_REPOSITORY) private readonly offers: IShoppingOfferRepository,
    @Inject(SHOPPING_REFERENCE_REPOSITORY) private readonly reference: IShoppingReferenceRepository,
    private readonly config: ShoppingConfigService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Create a request. The server fixes everything that is money: the goods
   * budget is the sum of the items, the estimate comes from the configured
   * rates, and the bidding deadline is now plus the configured window. None of
   * these can be sent by the client.
   */
  async create(
    customerId: string,
    dto: CreateShoppingRequestDto,
  ): Promise<ShoppingRequestResponseDto> {
    await this.assertReferences(dto);

    const rules = await this.config.getRules();
    const estimatedGoodsBudget = goodsBudget(dto.items);
    const estimate = calculateEstimate(estimatedGoodsBudget, rules);
    this.assertWithinCaps(dto, estimatedGoodsBudget, estimate.estimatedTotal);
    const now = new Date();

    const created = await this.requests.create({
      customerId,
      shoppingLocationId: dto.locationId,
      handoffArea: dto.handoffArea,
      deliveryAddress: dto.deliveryAddress.text,
      deliveryLatitude: dto.deliveryAddress.latitude,
      deliveryLongitude: dto.deliveryAddress.longitude,
      note: dto.note,
      estimatedGoodsBudget,
      estimate: { ...estimate },
      offerDeadline: new Date(now.getTime() + rules.offerWindowMinutes * 60_000),
      offerAcceptanceWindowMinutes: rules.offerAcceptanceWindowMinutes,
      items: dto.items.map((item) => ({
        name: item.name,
        brand: item.brand,
        size: item.size,
        quantity: item.quantity,
        unit: item.unit,
        estimatedUnitPrice: item.estimatedUnitPrice,
        notes: item.notes,
        substitutionPreference: item.substitutionPreference,
        maxSubstitutePrice: item.maxSubstitutePrice ?? undefined,
        categoryId: item.categoryId,
      })),
    });

    await this.record(customerId, 'SHOPPING_REQUEST_CREATED', created.id, {
      reference: created.reference,
      itemCount: created.items.length,
      estimatedGoodsBudget,
    });
    return toRequestResponse(created);
  }

  async findAll(
    customerId: string,
    query: ShoppingRequestQueryDto,
  ): Promise<IPaginatedResult<ShoppingRequestResponseDto>> {
    await this.expireElapsed(customerId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const { rows, total } = await this.requests.listForCustomer(
      customerId,
      (page - 1) * limit,
      limit,
      query.status,
    );
    return { data: rows.map(toRequestResponse), meta: createPaginationMeta(page, limit, total) };
  }

  /** The request with its items and every live offer, each with a full breakdown and the shopper's stats. */
  async findOne(customerId: string, id: string): Promise<ShoppingRequestDetailResponseDto> {
    // Offers whose ACCEPTANCE window has ended read as EXPIRED. (Closing the bidding
    // deadline does not expire them: they stay acceptable until their own expiresAt.)
    await this.offers.expireDue(new Date(), { requestId: id });
    await this.expireElapsed(customerId, id);
    const request = await this.requests.findOwnedById(id, customerId);
    if (!request) {
      throw new ResourceNotFoundException('Shopping request', id);
    }
    return toRequestDetail(request, await this.offers.listForRequest(id));
  }

  /**
   * Lazily mark requests EXPIRED once bidding closed more than the acceptance
   * window ago (the window stored on each request when it was created or reopened) and no offer on them can still be accepted (like offers, there is
   * no cron). A conditional update in the repository, so it races safely with an
   * accept or a cancel.
   */
  private async expireElapsed(customerId: string, requestId?: string): Promise<void> {
    await this.requests.expireElapsed({ customerId, requestId }, new Date());
  }

  async cancel(customerId: string, id: string): Promise<ShoppingRequestResponseDto> {
    const result = await this.requests.cancel(id, customerId, new Date());
    if (result.outcome === 'not_found') {
      throw new ResourceNotFoundException('Shopping request', id);
    }
    if (result.outcome === 'not_open') {
      throw new ConflictException(
        `Only an open request can be cancelled; this one is ${result.status.toLowerCase()}`,
      );
    }
    await this.record(customerId, 'SHOPPING_REQUEST_CANCELLED', id, {
      reference: result.request.reference,
    });
    return toRequestResponse(result.request);
  }

  /** 422 before any write: an amount past MAX_AMOUNT would overflow the integer columns. */
  private assertWithinCaps(
    dto: CreateShoppingRequestDto,
    goods: number,
    estimatedTotal: number,
  ): void {
    const tooBig = (field: string, what: string): ValidationException =>
      new ValidationException(
        [{ field, message: `${what} must not exceed ₦${MAX_AMOUNT.toLocaleString('en-NG')}` }],
        'Amount is too large',
      );
    // `!(x <= MAX)` also catches NaN/Infinity from a malformed item.
    const within = (amount: number): boolean => Number.isFinite(amount) && amount <= MAX_AMOUNT;
    dto.items.forEach((item, index) => {
      if (!within(item.quantity * item.estimatedUnitPrice)) {
        throw tooBig(`items[${index}]`, 'quantity x estimatedUnitPrice');
      }
    });
    if (!within(goods)) throw tooBig('items', 'The total of all items');
    if (!within(estimatedTotal)) throw tooBig('items', 'The estimated total including fees');
  }

  private async assertReferences(dto: CreateShoppingRequestDto): Promise<void> {
    if ((await this.reference.findActiveLocationIds([dto.locationId])).length === 0) {
      throw new BadRequestException(`Unknown or inactive location id: ${dto.locationId}`);
    }
    const categoryIds = [
      ...new Set(dto.items.map((item) => item.categoryId).filter((id): id is string => !!id)),
    ];
    if (categoryIds.length > 0) {
      const known = new Set(await this.reference.findActiveCategoryIds(categoryIds));
      const unknown = categoryIds.filter((id) => !known.has(id));
      if (unknown.length > 0) {
        throw new BadRequestException(`Unknown or inactive category id: ${unknown.join(', ')}`);
      }
    }
  }

  /** Audit is best effort: a failed log write must not fail the request that already happened. */
  private async record(
    userId: string,
    action: string,
    entityId: string,
    details: Record<string, string | number>,
  ): Promise<void> {
    try {
      await this.audit.log({ userId, action, entity: 'ShoppingRequest', entityId, details });
    } catch (error) {
      this.logger.error(`Failed to record ${action} for shopping request ${entityId}: ${error}`);
    }
  }
}
