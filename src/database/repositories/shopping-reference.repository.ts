import { Injectable } from '@nestjs/common';
import type { ExtraService, ShoppingCategory, ShoppingLocation } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { IShoppingReferenceRepository } from './interfaces';

@Injectable()
export class ShoppingReferenceRepository implements IShoppingReferenceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listCategories(): Promise<ShoppingCategory[]> {
    return this.prisma.shoppingCategory.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async listLocations(): Promise<ShoppingLocation[]> {
    return this.prisma.shoppingLocation.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async listServices(): Promise<ExtraService[]> {
    return this.prisma.extraService.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async findActiveCategoryIds(ids: string[]): Promise<string[]> {
    const rows = await this.prisma.shoppingCategory.findMany({
      where: { id: { in: ids }, isActive: true },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async findActiveLocationIds(ids: string[]): Promise<string[]> {
    const rows = await this.prisma.shoppingLocation.findMany({
      where: { id: { in: ids }, isActive: true },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async findActiveServiceIds(ids: string[]): Promise<string[]> {
    const rows = await this.prisma.extraService.findMany({
      where: { id: { in: ids }, isActive: true },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }
}
