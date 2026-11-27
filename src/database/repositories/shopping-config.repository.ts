import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { IShoppingConfigRepository, IShoppingFeeRules } from './interfaces';

@Injectable()
export class ShoppingConfigRepository implements IShoppingConfigRepository {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<IShoppingFeeRules | null> {
    const row = await this.prisma.shoppingConfig.findUnique({ where: { id: 1 } });
    if (!row) {
      return null;
    }
    return {
      minShopperFee: row.minShopperFee,
      maxShopperFee: row.maxShopperFee,
      deliveryFee: row.deliveryFee,
      serviceChargePercent: Number(row.serviceChargePercent),
      vatPercent: Number(row.vatPercent),
      priceBufferPercent: Number(row.priceBufferPercent),
      offerWindowMinutes: row.offerWindowMinutes,
      shopperAcceptWindowMinutes: row.shopperAcceptWindowMinutes,
    };
  }
}
