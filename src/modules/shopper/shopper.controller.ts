import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ShopperService } from './shopper.service';
import {
  OnboardShopperDto,
  SetAvailabilityDto,
  ShopperProfileResponseDto,
  UpdateShopperProfileDto,
} from './dto';
import { Roles } from '@common/decorators/roles.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import {
  ApiCreatedSuccessResponse,
  ApiErrorResponses,
  ApiSuccessResponse,
} from '@/common/decorators';
import { IRequestUser } from '@common/interfaces';

@ApiTags('Shopper')
@Controller('shopper')
@Roles(UserRole.PERSONAL_SHOPPER)
@ApiBearerAuth()
export class ShopperController {
  constructor(private readonly shopperService: ShopperService) {}

  @Post('onboarding')
  @ApiOperation({
    summary: 'Submit the shopper application',
    description:
      'Moves the account to VERIFICATION_PENDING. Can be resubmitted until the account is approved; ' +
      'returns 409 once it is approved, suspended or deactivated. Reference data is sent as ids from ' +
      'GET /shopper/categories, /locations and /services.',
  })
  @ApiCreatedSuccessResponse(ShopperProfileResponseDto)
  @ApiErrorResponses()
  async onboard(
    @CurrentUser() user: IRequestUser,
    @Body() dto: OnboardShopperDto,
  ): Promise<{ data: ShopperProfileResponseDto }> {
    return { data: await this.shopperService.submitOnboarding(user.id, dto) };
  }

  @Get('profile')
  @ApiOperation({
    summary: 'Get the shopper profile',
    description: 'Creates a default REGISTERED profile on first read.',
  })
  @ApiSuccessResponse(ShopperProfileResponseDto)
  @ApiErrorResponses()
  async getProfile(
    @CurrentUser() user: IRequestUser,
  ): Promise<{ data: ShopperProfileResponseDto }> {
    return { data: await this.shopperService.getProfile(user.id) };
  }

  @Patch('profile')
  @ApiOperation({
    summary: 'Update the shopper profile',
    description:
      'Partial update. A relation set that is sent replaces the stored one. Suspended or deactivated accounts get 403.',
  })
  @ApiSuccessResponse(ShopperProfileResponseDto)
  @ApiErrorResponses()
  async updateProfile(
    @CurrentUser() user: IRequestUser,
    @Body() dto: UpdateShopperProfileDto,
  ): Promise<{ data: ShopperProfileResponseDto }> {
    return { data: await this.shopperService.updateProfile(user.id, dto) };
  }

  @Patch('availability')
  @ApiOperation({
    summary: 'Go online or offline',
    description: 'The dashboard toggle. 403 unless the account is APPROVED.',
  })
  @ApiSuccessResponse(ShopperProfileResponseDto)
  @ApiErrorResponses()
  async setAvailability(
    @CurrentUser() user: IRequestUser,
    @Body() dto: SetAvailabilityDto,
  ): Promise<{ data: ShopperProfileResponseDto }> {
    return { data: await this.shopperService.setOnline(user.id, dto) };
  }
}
