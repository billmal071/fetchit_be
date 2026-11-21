import { Controller, Get, HttpCode, HttpStatus, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  ApiSuccessResponse,
  ApiErrorResponses,
  ApiPaginatedResponse,
} from '@/common/decorators';
import { IMeta, IRequestUser } from '@/common/interfaces';
import { ParseUUIDPipe } from '@/common/pipes';
import { NotificationsService } from './notifications.service';
import {
  NotificationQueryDto,
  NotificationResponseDto,
  ReadAllResponseDto,
  UnreadCountResponseDto,
} from './dto';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List my notifications',
    description: "The caller's own notifications, newest first.",
  })
  @ApiPaginatedResponse(NotificationResponseDto)
  @ApiErrorResponses()
  async list(
    @CurrentUser() user: IRequestUser,
    @Query() query: NotificationQueryDto,
  ): Promise<{ data: NotificationResponseDto[]; meta: IMeta }> {
    return this.notificationsService.list(user.id, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Count my unread notifications' })
  @ApiSuccessResponse(UnreadCountResponseDto)
  @ApiErrorResponses()
  async unreadCount(@CurrentUser() user: IRequestUser): Promise<{ data: UnreadCountResponseDto }> {
    return { data: await this.notificationsService.unreadCount(user.id) };
  }

  // Must stay above the ':id' routes so "read-all" is not captured as an id.
  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all my notifications as read' })
  @ApiSuccessResponse(ReadAllResponseDto)
  @ApiErrorResponses()
  async markAllRead(@CurrentUser() user: IRequestUser): Promise<{ data: ReadAllResponseDto }> {
    return { data: await this.notificationsService.markAllRead(user.id) };
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark one of my notifications as read',
    description:
      'Idempotent (the first read time is kept). 404 if it does not exist or is not the caller’s.',
  })
  @ApiParam({ name: 'id', description: 'Notification id' })
  @ApiErrorResponses()
  async markRead(
    @CurrentUser() user: IRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.notificationsService.markRead(user.id, id);
  }
}
