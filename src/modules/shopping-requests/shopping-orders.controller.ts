import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ShoppingOrdersService } from './shopping-orders.service';
import {
  CancelOrderDto,
  CustomerOrderDetailResponseDto,
  CustomerOrderResponseDto,
  OrderEventResponseDto,
  OrderQueryDto,
} from './dto';
import { Roles } from '@common/decorators/roles.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { ApiErrorResponses, ApiPaginatedResponse, ApiSuccessResponse } from '@/common/decorators';
import { ParseUUIDPipe } from '@/common/pipes';
import { IRequestUser } from '@common/interfaces';
import type { IMeta } from '@common/interfaces';
import { SUCCESS_MESSAGES } from '@common/constants';

@ApiTags('Shopping Orders')
@ApiBearerAuth()
@Controller('shopping-orders')
@Roles(UserRole.CUSTOMER)
export class ShoppingOrdersController {
  constructor(private readonly service: ShoppingOrdersService) {}

  @Get()
  @ApiOperation({
    summary: 'List your orders',
    description: 'Newest first. filter: active (not completed or cancelled), completed, cancelled.',
  })
  @ApiPaginatedResponse(CustomerOrderResponseDto)
  @ApiErrorResponses()
  async list(
    @CurrentUser() user: IRequestUser,
    @Query() query: OrderQueryDto,
  ): Promise<{ data: CustomerOrderResponseDto[]; meta: IMeta }> {
    const { data, meta } = await this.service.list(user.id, query);
    return { data, meta };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get one of your orders',
    description:
      'Items, the financial breakdown copied from the accepted offer, the shopper public profile ' +
      '(never their contact details) and the event trail, newest first. Unpaid: payment is not built yet.',
  })
  @ApiParam({ name: 'id', description: 'Order UUID' })
  @ApiSuccessResponse(CustomerOrderDetailResponseDto)
  @ApiErrorResponses()
  async findOne(
    @CurrentUser() user: IRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ data: CustomerOrderDetailResponseDto }> {
    return { data: await this.service.findOne(user.id, id) };
  }

  @Get(':id/events')
  @ApiOperation({ summary: 'List the events of one of your orders', description: 'Newest first.' })
  @ApiParam({ name: 'id', description: 'Order UUID' })
  @ApiSuccessResponse(OrderEventResponseDto, true)
  @ApiErrorResponses()
  async events(
    @CurrentUser() user: IRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ data: OrderEventResponseDto[] }> {
    return { data: await this.service.listEvents(user.id, id) };
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Cancel an order the shopper has not accepted',
    description:
      'Only while the order is ASSIGNED. The request goes back to OPEN with a fresh offer deadline so ' +
      'shoppers can bid again (the earlier bidders stay rejected), and the shopper is notified. ' +
      '409 once the shopper has accepted. Repeating it on an already cancelled order returns that ' +
      'order with 200. 404 for an order that is not yours. An order the shopper did not accept ' +
      'within the configured window is cancelled automatically (reason "Shopper did not accept in time").',
  })
  @ApiParam({ name: 'id', description: 'Order UUID' })
  @ApiSuccessResponse(CustomerOrderResponseDto)
  @ApiErrorResponses()
  async cancel(
    @CurrentUser() user: IRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelOrderDto,
  ): Promise<{ data: CustomerOrderResponseDto; message: string }> {
    const { data } = await this.service.cancelOrder(user.id, id, dto);
    return { data, message: SUCCESS_MESSAGES.SHOPPING_ORDER_CANCELLED };
  }
}
