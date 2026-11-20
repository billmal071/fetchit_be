import { Module } from '@nestjs/common';
import { ShopperController } from './shopper.controller';
import { ShopperReferenceController } from './shopper-reference.controller';
import { ShopperService } from './shopper.service';

@Module({
  controllers: [ShopperController, ShopperReferenceController],
  providers: [ShopperService],
  exports: [ShopperService],
})
export class ShopperModule {}
