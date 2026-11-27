import { Body, Controller, Delete, Get, HttpStatus, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ShoppingRequestsService } from './shopping-requests.service';
import { ShoppingOrdersService } from './shopping-orders.service';
import {
  CreateShoppingRequestDto,
  CustomerOrderResponseDto,
  ShoppingRequestDetailResponseDto,
  ShoppingRequestQueryDto,
  ShoppingRequestResponseDto,
} from './dto';
import { Roles } from '@common/decorators/roles.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import {
  ApiCreatedSuccessResponse,
  ApiErrorResponses,
  ApiPaginatedResponse,
  ApiSuccessResponse,
} from '@/common/decorators';
import { ParseUUIDPipe } from '@/common/pipes';
import { IRequestUser } from '@common/interfaces';
import type { IMeta } from '@common/interfaces';
import { SUCCESS_MESSAGES } from '@common/constants';

@ApiTags('Shopping Requests')
@ApiBearerAuth()
@Controller('shopping-requests')
@Roles(UserRole.CUSTOMER)
export class ShoppingRequestsController {
  constructor(
    private readonly service: ShoppingRequestsService,
    private readonly orders: ShoppingOrdersService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Create a shopping request',
    description:
      'Every item needs name, brand, size, quantity, unit, estimatedUnitPrice and a ' +
      'substitutionPreference (REFUND, or SIMILAR_UP_TO with maxSubstitutePrice). The response ' +
      'carries a server-calculated estimate (goods + delivery + service charge + VAT); the ' +
      'shopper fee is set by bids. offerDeadline is now plus the configured offer window.',
  })
  @ApiCreatedSuccessResponse(ShoppingRequestResponseDto)
  @ApiErrorResponses()
  async create(
    @CurrentUser() user: IRequestUser,
    @Body() dto: CreateShoppingRequestDto,
  ): Promise<{ data: ShoppingRequestResponseDto; message: string }> {
    const data = await this.service.create(user.id, dto);
    return { data, message: SUCCESS_MESSAGES.SHOPPING_REQUEST_CREATED };
  }

  @Get()
  @ApiOperation({ summary: 'List your shopping requests', description: 'Newest first.' })
  @ApiPaginatedResponse(ShoppingRequestResponseDto)
  @ApiErrorResponses()
  async findAll(
    @CurrentUser() user: IRequestUser,
    @Query() query: ShoppingRequestQueryDto,
  ): Promise<{ data: ShoppingRequestResponseDto[]; meta: IMeta }> {
    const { data, meta } = await this.service.findAll(user.id, query);
    return { data, meta };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get one of your shopping requests',
    description:
      'Includes the items and every offer except withdrawn ones (cheapest shopper fee first). ' +
      'Each offer carries a full server-calculated breakdown and the shopper public stats ' +
      '(rating, completed orders, completion rate). Offers past the deadline read as EXPIRED.',
  })
  @ApiParam({ name: 'id', description: 'Shopping request UUID' })
  @ApiSuccessResponse(ShoppingRequestDetailResponseDto)
  @ApiErrorResponses()
  async findOne(
    @CurrentUser() user: IRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ data: ShoppingRequestDetailResponseDto }> {
    return { data: await this.service.findOne(user.id, id) };
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Cancel a shopping request',
    description:
      'Only while OPEN (409 otherwise). Pending offers on it become EXPIRED. Safe against a ' +
      'shopper submitting at the same moment: either the offer lands and is expired, or the ' +
      'submit gets a 409.',
  })
  @ApiParam({ name: 'id', description: 'Shopping request UUID' })
  @ApiSuccessResponse(ShoppingRequestResponseDto)
  @ApiErrorResponses()
  async cancel(
    @CurrentUser() user: IRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ data: ShoppingRequestResponseDto; message: string }> {
    const data = await this.service.cancel(user.id, id);
    return { data, message: SUCCESS_MESSAGES.SHOPPING_REQUEST_CANCELLED };
  }

  @Post(':id/offers/:offerId/accept')
  @ApiOperation({
    summary: 'Accept an offer',
    description:
      'Atomically: the offer becomes ACCEPTED, every other pending offer REJECTED, the request ' +
      'ASSIGNED, and an order is created in state ASSIGNED. The order is UNPAID: nothing is charged ' +
      '(payment is not built yet). The order money is the offer breakdown, copied; send no body. ' +
      '409 if the request is not OPEN, the offer is not PENDING or has expired, the shopper is no ' +
      'longer APPROVED, or a concurrent accept or cancel won. Repeating the accept of the offer that ' +
      'was already accepted returns 200 with the same order. 404 for a request that is not yours.',
  })
  @ApiParam({ name: 'id', description: 'Shopping request UUID' })
  @ApiParam({ name: 'offerId', description: 'Offer UUID' })
  @ApiCreatedSuccessResponse(CustomerOrderResponseDto)
  @ApiErrorResponses()
  async acceptOffer(
    @CurrentUser() user: IRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ data: CustomerOrderResponseDto; message: string }> {
    const { data, created } = await this.orders.acceptOffer(user.id, id, offerId);
    // 201 for a new order; 200 when a retry gets the existing one back.
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return { data, message: SUCCESS_MESSAGES.SHOPPING_OFFER_ACCEPTED };
  }
}
