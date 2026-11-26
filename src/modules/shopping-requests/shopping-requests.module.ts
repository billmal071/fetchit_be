import { Module } from '@nestjs/common';
import { ShoppingRequestsController } from './shopping-requests.controller';
import { ShopperRequestsController } from './shopper-requests.controller';
import { ShoppingRequestsService } from './shopping-requests.service';
import { ShopperBiddingService } from './shopper-bidding.service';
import { ShoppingConfigService } from './shopping-config.service';

@Module({
  controllers: [ShoppingRequestsController, ShopperRequestsController],
  providers: [ShoppingRequestsService, ShopperBiddingService, ShoppingConfigService],
  exports: [ShoppingRequestsService, ShopperBiddingService],
})
export class ShoppingRequestsModule {}
