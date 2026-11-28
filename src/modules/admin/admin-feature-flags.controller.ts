import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { AdminFeatureFlagsService } from './admin-feature-flags.service';
import { FeatureFlagAdminResponseDto, UpdateFeatureFlagDto } from './dto';
import { Roles } from '@common/decorators/roles.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { ApiErrorResponses, ApiSuccessResponse } from '@/common/decorators';
import { IRequestUser } from '@common/interfaces';

@ApiTags('Admin - Feature Flags')
@Controller('admin/feature-flags')
@Roles(UserRole.ADMIN)
@ApiBearerAuth()
export class AdminFeatureFlagsController {
  constructor(private readonly service: AdminFeatureFlagsService) {}

  @Get()
  @ApiOperation({
    summary: 'List the feature flags',
    description:
      'Every flag with what it gates, whether it is on, which roles it is limited to (empty = ' +
      'everyone) and who last changed it. Flags are defined in code and a migration: there is no ' +
      'way to create or delete one here.',
  })
  @ApiSuccessResponse(FeatureFlagAdminResponseDto, true)
  @ApiErrorResponses()
  async list(): Promise<{ data: FeatureFlagAdminResponseDto[] }> {
    return { data: await this.service.list() };
  }

  @Patch(':key')
  @ApiOperation({
    summary: 'Turn a feature flag on or off, or limit it to some roles',
    description:
      'Send enabled, allowedRoles, or both. ADMIN always passes every flag, so staff can test a ' +
      'feature that is off. A gated route answers 404 FEATURE_DISABLED to anyone it is off for. The ' +
      'change is visible at once on the server process that handled it and within 10 seconds on ' +
      'any other. 404 for a key that is not a known flag. Nothing is written (and nothing audited) ' +
      'when the values are already the stored ones.',
  })
  @ApiParam({ name: 'key', example: 'shopper_marketplace' })
  @ApiSuccessResponse(FeatureFlagAdminResponseDto)
  @ApiErrorResponses()
  async update(
    @CurrentUser() user: IRequestUser,
    @Param('key') key: string,
    @Body() dto: UpdateFeatureFlagDto,
  ): Promise<{ data: FeatureFlagAdminResponseDto; message: string }> {
    return {
      data: await this.service.update(user.id, key, dto),
      message: 'Feature flag updated',
    };
  }
}
