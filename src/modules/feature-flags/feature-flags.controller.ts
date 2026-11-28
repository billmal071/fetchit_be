import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { ApiErrorResponses, ApiSuccessResponse } from '@/common/decorators';
import { FEATURE_FLAGS } from '@common/constants';
import { IRequestUser } from '@common/interfaces';
import { FeatureFlagService } from './feature-flag.service';

class FlagsMap {
  @ApiProperty({ example: true }) [FEATURE_FLAGS.SHOPPER_MARKETPLACE]: boolean;
  @ApiProperty({ example: true }) [FEATURE_FLAGS.SHOPPER_ORDERS]: boolean;
  @ApiProperty({ example: true }) [FEATURE_FLAGS.HANDYMAN_APPLICATION_FLOWS]: boolean;
}

export class EvaluatedFlagsResponseDto {
  @ApiProperty({ type: FlagsMap }) flags: FlagsMap;
}

@ApiTags('Feature Flags')
@Controller('feature-flags')
@ApiBearerAuth()
export class FeatureFlagsController {
  constructor(private readonly flags: FeatureFlagService) {}

  @Get()
  @ApiOperation({
    summary: 'Which features are on for me',
    description:
      'Every feature flag evaluated for the caller role, as booleans only, so the app can hide ' +
      'menus and screens. A flag that is off answers 404 FEATURE_DISABLED on the routes it gates. ' +
      'Staff (ADMIN) always see every flag as true. A change can take up to 10 seconds to show ' +
      'on another server process.',
  })
  @ApiSuccessResponse(EvaluatedFlagsResponseDto)
  @ApiErrorResponses()
  async mine(@CurrentUser() user: IRequestUser): Promise<{ data: EvaluatedFlagsResponseDto }> {
    return { data: { flags: await this.flags.evaluateAll(user.role) } };
  }
}
