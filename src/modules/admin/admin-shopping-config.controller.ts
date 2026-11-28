import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { AdminShoppingConfigService } from './admin-shopping-config.service';
import { ShoppingConfigResponseDto, UpdateShoppingConfigDto } from './dto';
import { Roles } from '@common/decorators/roles.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { ApiErrorResponses, ApiSuccessResponse } from '@/common/decorators';
import { IRequestUser } from '@common/interfaces';

@ApiTags('Admin - Shopping Config')
@Controller('admin/shopping-config')
@Roles(UserRole.ADMIN)
@ApiBearerAuth()
export class AdminShoppingConfigController {
  constructor(private readonly service: AdminShoppingConfigService) {}

  @Get()
  @ApiOperation({
    summary: 'Get the shopping configuration',
    description:
      'The fee rules, shopper-fee bounds and time windows every shopping price and deadline is ' +
      'calculated from, with when and by whom they were last changed.',
  })
  @ApiSuccessResponse(ShoppingConfigResponseDto)
  @ApiErrorResponses()
  async get(): Promise<{ data: ShoppingConfigResponseDto }> {
    return { data: await this.service.get() };
  }

  @Patch()
  @ApiOperation({
    summary: 'Edit the shopping configuration',
    description:
      'Partial update: send only the fields to change (at least one). The merged result is validated ' +
      'under a row lock, so editing only minShopperFee or only maxShopperFee is checked against the ' +
      'stored other side, and two concurrent edits cannot together break a rule (422 with the reason). ' +
      'Takes effect on the next calculation; it applies to NEW requests, offers and orders, and ' +
      'existing ones keep their snapshot: an offer keeps its financials and its expiresAt, a request ' +
      'keeps its estimate and its bidding deadline, an order keeps its financials. The one exception ' +
      'is shopperAcceptWindowMinutes: it is read when an order is looked at or accepted, so changing ' +
      'it also affects orders that are still ASSIGNED (shortening it can cancel them at their next read). ' +
      'offerAcceptanceWindowMinutes, offerWindowMinutes and the fee settings affect only what is ' +
      'created from now on. Each edit is recorded in the audit log with the before and after of the ' +
      'changed fields only.',
  })
  @ApiSuccessResponse(ShoppingConfigResponseDto)
  @ApiErrorResponses()
  async update(
    @CurrentUser() user: IRequestUser,
    @Body() dto: UpdateShoppingConfigDto,
  ): Promise<{ data: ShoppingConfigResponseDto; message: string }> {
    return {
      data: await this.service.update(user.id, dto),
      message: 'Shopping configuration updated',
    };
  }
}
