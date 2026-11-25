import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { IsBase64UrlBytes } from './base64url-bytes.validator';

export class PushKeysDto {
  @ApiProperty({ description: 'Browser public key (base64url), PushSubscription.getKey("p256dh")' })
  @IsString()
  @MaxLength(255)
  @IsBase64UrlBytes({ exact: 65 })
  p256dh: string;

  @ApiProperty({ description: 'Browser auth secret (base64url), PushSubscription.getKey("auth")' })
  @IsString()
  @MaxLength(255)
  @IsBase64UrlBytes({ min: 16 })
  auth: string;
}

export class SubscribePushDto {
  @ApiProperty({
    description: 'Push service endpoint URL (https, known push-service hosts only)',
    maxLength: 2048,
  })
  @IsString()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  endpoint: string;

  @ApiProperty({ type: PushKeysDto })
  @IsDefined()
  // ValidateNested validates the elements of an array, and an empty array has
  // none, so `keys: []` used to pass and reach the service with no keys.
  @IsObject()
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys: PushKeysDto;

  @ApiPropertyOptional({ maxLength: 512 })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  userAgent?: string;
}
