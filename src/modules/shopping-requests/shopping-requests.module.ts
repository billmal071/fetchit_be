import { Module } from '@nestjs/common';
import { ShoppingRequestsController } from './shopping-requests.controller';
import { ShopperRequestsController } from './shopper-requests.controller';
import { ShoppingOrdersController } from './shopping-orders.controller';
import { ShopperOrdersController } from './shopper-orders.controller';
import { ShoppingRequestsService } from './shopping-requests.service';
import { ShopperBiddingService } from './shopper-bidding.service';
import { ShoppingOrdersService } from './shopping-orders.service';
import { ShopperOrdersService } from './shopper-orders.service';
import { ShoppingConfigService } from './shopping-config.service';

@Module({
  controllers: [
    ShoppingRequestsController,
    ShopperRequestsController,
    ShoppingOrdersController,
    ShopperOrdersController,
  ],
  providers: [
    ShoppingRequestsService,
    ShopperBiddingService,
    ShoppingOrdersService,
    ShopperOrdersService,
    ShoppingConfigService,
  ],
  exports: [
    ShoppingRequestsService,
    ShopperBiddingService,
    ShoppingOrdersService,
    ShopperOrdersService,
  ],
})
export class ShoppingRequestsModule {}
