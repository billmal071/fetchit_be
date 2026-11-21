import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, ApiSuccessResponse, ApiErrorResponses } from '@/common/decorators';
import { IRequestUser } from '@/common/interfaces';
import { PushService } from './push.service';
import { PushConfigResponseDto, SubscribePushDto, UnsubscribePushDto } from './dto';

@ApiTags('Push')
@ApiBearerAuth()
@Controller('push')
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Get('config')
  @ApiOperation({ summary: 'Web Push availability and VAPID public key' })
  @ApiSuccessResponse(PushConfigResponseDto)
  @ApiErrorResponses()
  getConfig(): { data: PushConfigResponseDto } {
    return { data: this.pushService.getConfig() };
  }

  @Post('subscriptions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register this browser for push notifications',
    description: 'Upserts by endpoint; an endpoint registered by another user moves to the caller.',
  })
  @ApiErrorResponses()
  async subscribe(@CurrentUser() user: IRequestUser, @Body() dto: SubscribePushDto): Promise<void> {
    await this.pushService.subscribe(user.id, dto);
  }

  @Delete('subscriptions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remove this browser from push notifications',
    description: "Removes only the caller's subscription; succeeds even if it does not exist.",
  })
  @ApiErrorResponses()
  async unsubscribe(
    @CurrentUser() user: IRequestUser,
    @Body() dto: UnsubscribePushDto,
  ): Promise<void> {
    await this.pushService.unsubscribe(user.id, dto);
  }
}
