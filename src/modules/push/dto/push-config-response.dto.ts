import { ApiProperty } from '@nestjs/swagger';

export class PushConfigResponseDto {
  @ApiProperty({ description: 'False when VAPID keys are not (fully) configured' })
  enabled: boolean;

  @ApiProperty({ type: String, nullable: true, description: 'VAPID public key, null if disabled' })
  publicKey: string | null;
}
