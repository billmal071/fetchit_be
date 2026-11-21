import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PaginationDto } from '@common/dto/pagination.dto';

const parseBool = (value: unknown): unknown => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

export class NotificationQueryDto extends PaginationDto {
  // The global pipe turns on implicit conversion, which would run Boolean() on
  // the raw query string first: "false" becomes true and the caller silently
  // gets only unread items. Reading the original value and parsing it
  // explicitly keeps "false" false; anything other than true/false is a 400.
  @ApiPropertyOptional({
    type: Boolean,
    default: false,
    description: 'Only return unread notifications',
  })
  @IsOptional()
  @Transform(({ obj }: { obj: Record<string, unknown> }) => parseBool(obj.unreadOnly))
  @IsBoolean()
  unreadOnly?: boolean;
}
