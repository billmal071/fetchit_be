import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ShopperOrdersService } from './shopper-orders.service';
import { OrderEventResponseDto, OrderQueryDto, ShopperOrderResponseDto } from './dto';
import { Roles } from '@common/decorators/roles.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { ApiErrorResponses, ApiPaginatedResponse, ApiSuccessResponse } from '@/common/decorators';
import { ParseUUIDPipe } from '@/common/pipes';
import { IRequestUser } from '@common/interfaces';
import type { IMeta } from '@common/interfaces';
import { FEATURE_FLAGS, SUCCESS_MESSAGES } from '@common/constants';
import { RequireFeature } from '@modules/feature-flags/require-feature.decorator';

/** The shopper's orders. APPROVED shoppers only (403); someone else's order is a 404. */
@ApiTags('Shopper Orders')
@RequireFeature(FEATURE_FLAGS.SHOPPER_ORDERS)
@ApiBearerAuth()
@Controller('shopper/orders')
@Roles(UserRole.PERSONAL_SHOPPER)
export class ShopperOrdersController {
  constructor(private readonly service: ShopperOrdersService) {}

  @Get()
  @ApiOperation({
    summary: 'List your orders',
    description: 'Newest first. filter: active (not completed or cancelled), completed, cancelled.',
  })
  @ApiPaginatedResponse(ShopperOrderResponseDto)
  @ApiErrorResponses()
  async list(
    @CurrentUser() user: IRequestUser,
    @Query() query: OrderQueryDto,
  ): Promise<{ data: ShopperOrderResponseDto[]; meta: IMeta }> {
    const { data, meta } = await this.service.list(user.id, query);
    return { data, meta };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get one of your orders',
    description:
      'Items, extraServices and receipts (empty for now), financials with shopperGrossEarnings and ' +
      'pendingApprovals (0 for now). The delivery address, coordinates, customer note and customer ' +
      'identity are not included: they are revealed after payment, in a later slice.',
  })
  @ApiParam({ name: 'id', description: 'Order UUID' })
  @ApiSuccessResponse(ShopperOrderResponseDto)
  @ApiErrorResponses()
  async findOne(
    @CurrentUser() user: IRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ data: ShopperOrderResponseDto }> {
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

  @Post(':id/accept')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Accept an assigned order',
    description:
      'ASSIGNED -> SHOPPER_ACCEPTED. 409 with a message the UI can show when the order is in any ' +
      'other state, including when a concurrent call already accepted it.',
  })
  @ApiParam({ name: 'id', description: 'Order UUID' })
  @ApiSuccessResponse(ShopperOrderResponseDto)
  @ApiErrorResponses()
  async accept(
    @CurrentUser() user: IRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ data: ShopperOrderResponseDto; message: string }> {
    const data = await this.service.accept(user.id, id);
    return { data, message: SUCCESS_MESSAGES.SHOPPER_ORDER_ACCEPTED };
  }

  @Post(':id/start')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Start shopping',
    description: 'SHOPPER_ACCEPTED -> SHOPPING_STARTED. 409 from any other state.',
  })
  @ApiParam({ name: 'id', description: 'Order UUID' })
  @ApiSuccessResponse(ShopperOrderResponseDto)
  @ApiErrorResponses()
  async start(
    @CurrentUser() user: IRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ data: ShopperOrderResponseDto; message: string }> {
    const data = await this.service.start(user.id, id);
    return { data, message: SUCCESS_MESSAGES.SHOPPER_ORDER_STARTED };
  }
}
