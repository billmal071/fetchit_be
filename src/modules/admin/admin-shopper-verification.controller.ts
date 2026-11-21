import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { AdminShopperVerificationService } from './admin-shopper-verification.service';
import { RejectShopperDto, ShopperApplicationQueryDto } from './dto';
import { Roles } from '@common/decorators/roles.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { ApiErrorResponses, ApiPaginatedResponse, ApiSuccessResponse } from '@/common/decorators';
import { ShopperApplicationResponseDto } from '@modules/shopper/dto';
import { IRequestUser } from '@common/interfaces';
import type { IMeta } from '@common/interfaces';
import { SUCCESS_MESSAGES } from '@common/constants';

@ApiTags('Admin - Shopper Verification')
@Controller('admin/shopper-verification')
@Roles(UserRole.ADMIN)
@ApiBearerAuth()
export class AdminShopperVerificationController {
  constructor(private readonly service: AdminShopperVerificationService) {}

  @Get()
  @ApiOperation({
    summary: 'List shopper applications',
    description:
      'Applications awaiting review (VERIFICATION_PENDING) by default, oldest first. Pass `state` to list another stage.',
  })
  @ApiPaginatedResponse(ShopperApplicationResponseDto)
  @ApiErrorResponses()
  async list(
    @Query() query: ShopperApplicationQueryDto,
  ): Promise<{ data: ShopperApplicationResponseDto[]; meta: IMeta }> {
    return this.service.list(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a shopper application for review',
    description: 'The shopper profile plus the applicant’s contact details.',
  })
  @ApiParam({ name: 'id', description: 'Shopper profile UUID' })
  @ApiSuccessResponse(ShopperApplicationResponseDto)
  @ApiErrorResponses()
  async getForReview(@Param('id') id: string): Promise<{ data: ShopperApplicationResponseDto }> {
    return { data: await this.service.getForReview(id) };
  }

  @Patch(':id/approve')
  @ApiOperation({
    summary: 'Approve a shopper application',
    description:
      'VERIFICATION_PENDING → APPROVED. Only a pending application can be approved (400 otherwise). ' +
      'This is what lets the shopper go online and see the request feed.',
  })
  @ApiParam({ name: 'id', description: 'Shopper profile UUID' })
  @ApiSuccessResponse(ShopperApplicationResponseDto)
  @ApiErrorResponses()
  async approve(
    @Param('id') id: string,
    @CurrentUser() user: IRequestUser,
  ): Promise<{ data: ShopperApplicationResponseDto; message: string }> {
    return {
      data: await this.service.approve(id, user.id),
      message: SUCCESS_MESSAGES.SHOPPER_APPROVED,
    };
  }

  @Patch(':id/reject')
  @ApiOperation({
    summary: 'Send a shopper application back for an update',
    description:
      'VERIFICATION_PENDING → VERIFICATION_REQUIRES_UPDATE, with a reason the shopper sees. ' +
      'The shopper can resubmit. Only a pending application can be sent back (400 otherwise).',
  })
  @ApiParam({ name: 'id', description: 'Shopper profile UUID' })
  @ApiSuccessResponse(ShopperApplicationResponseDto)
  @ApiErrorResponses()
  async reject(
    @Param('id') id: string,
    @Body() dto: RejectShopperDto,
    @CurrentUser() user: IRequestUser,
  ): Promise<{ data: ShopperApplicationResponseDto; message: string }> {
    return {
      data: await this.service.reject(id, user.id, dto),
      message: SUCCESS_MESSAGES.SHOPPER_REJECTED,
    };
  }
}
