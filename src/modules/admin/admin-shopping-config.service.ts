import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  IShoppingConfigPatch,
  IShoppingConfigRecord,
  IShoppingConfigRepository,
  SHOPPING_CONFIG_REPOSITORY,
  ShoppingConfigConstraintError,
} from '@/database/repositories';
import {
  BadRequestException,
  InternalServerException,
  ValidationException,
} from '@common/exceptions/base.exception';
import { AuditService } from '@common/services/audit.service';
import { ShoppingConfigResponseDto, UpdateShoppingConfigDto } from './dto';
import { validateShoppingConfig } from './admin-shopping-config.validation';

const toResponse = (record: IShoppingConfigRecord): ShoppingConfigResponseDto => ({
  minShopperFee: record.minShopperFee,
  maxShopperFee: record.maxShopperFee,
  deliveryFee: record.deliveryFee,
  serviceChargePercent: record.serviceChargePercent,
  vatPercent: record.vatPercent,
  priceBufferPercent: record.priceBufferPercent,
  offerWindowMinutes: record.offerWindowMinutes,
  shopperAcceptWindowMinutes: record.shopperAcceptWindowMinutes,
  offerAcceptanceWindowMinutes: record.offerAcceptanceWindowMinutes,
  updatedAt: record.updatedAt.toISOString(),
  updatedBy: record.updatedBy,
});

const missing = (): InternalServerException =>
  new InternalServerException('Shopping fee configuration has not been set up');

/**
 * Admin read and edit of the singleton shopping configuration. The prices,
 * fee bounds and windows are read from this row every time they are needed,
 * so an edit is live on the very next calculation (there is no cache).
 */
@Injectable()
export class AdminShoppingConfigService {
  private readonly logger = new Logger(AdminShoppingConfigService.name);

  constructor(
    @Inject(SHOPPING_CONFIG_REPOSITORY) private readonly config: IShoppingConfigRepository,
    private readonly auditService: AuditService,
  ) {}

  async get(): Promise<ShoppingConfigResponseDto> {
    const record = await this.config.getRecord();
    if (!record) throw missing();
    return toResponse(record);
  }

  async update(adminId: string, dto: UpdateShoppingConfigDto): Promise<ShoppingConfigResponseDto> {
    const patch: IShoppingConfigPatch = Object.fromEntries(
      Object.entries(dto).filter(([, value]) => value !== undefined),
    );
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('Send at least one field to change');
    }

    let result;
    try {
      result = await this.config.update(patch, adminId, validateShoppingConfig);
    } catch (error) {
      // The merged-result check above is the first line of defence; a database CHECK
      // is the last, and a refusal from it is still the admin's input, not a server fault.
      if (error instanceof ShoppingConfigConstraintError) {
        throw new ValidationException(
          [{ field: 'config', message: 'The values break a configuration constraint' }],
          'Invalid shopping configuration',
        );
      }
      throw error;
    }

    switch (result.outcome) {
      case 'missing':
        throw missing();
      case 'invalid':
        throw new ValidationException(result.errors, 'Invalid shopping configuration');
      case 'unchanged':
        return toResponse(result.record);
      default:
        await this.audit(adminId, result.before, result.after);
        return toResponse(result.record);
    }
  }

  /** Best-effort: the edit is committed, so a missing audit row must not fail the request. */
  private async audit(
    adminId: string,
    before: IShoppingConfigPatch,
    after: IShoppingConfigPatch,
  ): Promise<void> {
    try {
      await this.auditService.log({
        userId: adminId,
        action: 'SHOPPING_CONFIG_UPDATED',
        entity: 'ShoppingConfig',
        entityId: '1',
        details: { before, after },
      });
    } catch (error) {
      this.logger.error(`Failed to record SHOPPING_CONFIG_UPDATED: ${error}`);
    }
  }
}
