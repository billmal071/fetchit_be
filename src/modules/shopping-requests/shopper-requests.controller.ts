import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ShopperBiddingService } from './shopper-bidding.service';
import {
  OfferInputDto,
  ShopperOfferQueryDto,
  ShopperOfferResponseDto,
  ShopperOfferWithRequestResponseDto,
  ShopperRequestDetailResponseDto,
  ShopperRequestQueryDto,
  ShopperRequestSummaryResponseDto,
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

/**
 * The shopper side of requests and bidding. Every route needs an APPROVED
 * shopper (403 otherwise). Declared as its own controller so the class-level
 * role does not bleed onto the public reference routes in ShopperModule.
 */
@ApiTags('Shopper Requests')
@ApiBearerAuth()
@Controller('shopper')
@Roles(UserRole.PERSONAL_SHOPPER)
export class ShopperRequestsController {
  constructor(private readonly service: ShopperBiddingService) {}

  @Get('requests')
  @ApiOperation({
    summary: 'Browse matching shopping requests',
    description:
      'Matching is server-side: OPEN requests whose offer window is running, at a market the ' +
      'shopper covers, with at least one item in a category they cover. An offline shopper gets ' +
      'an empty page. Each row has earningsEstimate (midpoint of the configured fee range, with ' +
      'earningsRange), itemCount, estimatedGoodsBudget and hasSubmittedOffer. 403 unless APPROVED.',
  })
  @ApiPaginatedResponse(ShopperRequestSummaryResponseDto)
  @ApiErrorResponses()
  async feed(
    @CurrentUser() user: IRequestUser,
    @Query() query: ShopperRequestQueryDto,
  ): Promise<{ data: ShopperRequestSummaryResponseDto[]; meta: IMeta }> {
    const { data, meta } = await this.service.feed(user.id, query);
    return { data, meta };
  }

  @Get('requests/:id')
  @ApiOperation({
    summary: 'Get one shopping request',
    description:
      'Items included; the exact delivery address and the customer are never exposed. 404 if the ' +
      'request does not match the shopper and they have no offer on it.',
  })
  @ApiParam({ name: 'id', description: 'Shopping request UUID' })
  @ApiSuccessResponse(ShopperRequestDetailResponseDto)
  @ApiErrorResponses()
  async getRequest(
    @CurrentUser() user: IRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ data: ShopperRequestDetailResponseDto }> {
    return { data: await this.service.getRequest(user.id, id) };
  }

  @Post('requests/:id/offers/preview')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Preview an offer',
    description:
      'Side-effect free and repeatable: returns the offer as it would be submitted, with the full ' +
      'breakdown. Same errors as submit: 403 (not approved / offline), 404, 409 (closed), ' +
      '422 (shopperFee outside the configured range).',
  })
  @ApiParam({ name: 'id', description: 'Shopping request UUID' })
  @ApiSuccessResponse(ShopperOfferResponseDto)
  @ApiErrorResponses()
  async preview(
    @CurrentUser() user: IRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OfferInputDto,
  ): Promise<{ data: ShopperOfferResponseDto }> {
    return { data: await this.service.preview(user.id, id, dto) };
  }

  @Post('requests/:id/offers')
  @ApiOperation({
    summary: 'Submit an offer',
    description:
      'The body is { shopperFee, etaMinutes, note? } only. 409 if the request is not OPEN, its ' +
      'deadline has passed, or the shopper already has a PENDING offer on it (withdraw first); ' +
      '422 if shopperFee is outside the configured range. Notifies the customer.',
  })
  @ApiParam({ name: 'id', description: 'Shopping request UUID' })
  @ApiCreatedSuccessResponse(ShopperOfferResponseDto)
  @ApiErrorResponses()
  async submit(
    @CurrentUser() user: IRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OfferInputDto,
  ): Promise<{ data: ShopperOfferResponseDto; message: string }> {
    const data = await this.service.submit(user.id, id, dto);
    return { data, message: SUCCESS_MESSAGES.SHOPPING_OFFER_SUBMITTED };
  }

  @Get('offers')
  @ApiOperation({ summary: 'List your offers', description: 'Newest first; filter by state.' })
  @ApiPaginatedResponse(ShopperOfferWithRequestResponseDto)
  @ApiErrorResponses()
  async listOffers(
    @CurrentUser() user: IRequestUser,
    @Query() query: ShopperOfferQueryDto,
  ): Promise<{ data: ShopperOfferWithRequestResponseDto[]; meta: IMeta }> {
    const { data, meta } = await this.service.listOffers(user.id, query);
    return { data, meta };
  }

  @Get('offers/:id')
  @ApiOperation({ summary: 'Get one of your offers' })
  @ApiParam({ name: 'id', description: 'Offer UUID' })
  @ApiSuccessResponse(ShopperOfferWithRequestResponseDto)
  @ApiErrorResponses()
  async getOffer(
    @CurrentUser() user: IRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ data: ShopperOfferWithRequestResponseDto }> {
    return { data: await this.service.getOffer(user.id, id) };
  }

  @Delete('offers/:id')
  @ApiOperation({
    summary: 'Withdraw an offer',
    description: 'Only your own PENDING offer (409 otherwise). Moves it to WITHDRAWN.',
  })
  @ApiParam({ name: 'id', description: 'Offer UUID' })
  @ApiSuccessResponse(ShopperOfferWithRequestResponseDto)
  @ApiErrorResponses()
  async withdraw(
    @CurrentUser() user: IRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ data: ShopperOfferWithRequestResponseDto; message: string }> {
    const data = await this.service.withdraw(user.id, id);
    return { data, message: SUCCESS_MESSAGES.SHOPPING_OFFER_WITHDRAWN };
  }
}
