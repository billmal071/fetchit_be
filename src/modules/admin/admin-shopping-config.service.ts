import { Inject, Injectable } from '@nestjs/common';
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
 * so an edit is live on the very next calculation (there is no cache). What an
 * edit changes is only what is created afterwards: requests snapshot their own
 * acceptance window, offers their expiry and financials.
 */
@Injectable()
export class AdminShoppingConfigService {
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
      // The audit row is written in the update's own transaction: a change is never
      // committed unaudited, and if the audit insert fails the change rolls back and the
      // error propagates (500), so a retry applies AND audits it.
      result = await this.config.update(patch, adminId, validateShoppingConfig, (tx, change) =>
        this.auditService.log(
          {
            userId: adminId,
            action: 'SHOPPING_CONFIG_UPDATED',
            entity: 'ShoppingConfig',
            entityId: '1',
            details: { before: change.before, after: change.after },
          },
          tx,
        ),
      );
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
        return toResponse(result.record);
    }
  }
}
