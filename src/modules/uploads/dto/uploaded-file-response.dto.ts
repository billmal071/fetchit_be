import { ApiProperty } from '@nestjs/swagger';

/** Shape returned by `POST /uploads`. */
export class UploadedFileResponseDto {
  @ApiProperty({
    description: 'Server-generated storage key.',
    example: 'avatars/6f1e0f2c-.../3a9c1d5e-....png',
  })
  key: string;

  @ApiProperty({
    description: 'Resolvable URL for the stored object.',
    example: 'https://files.fetchit.com.ng/avatars/6f1e0f2c-.../3a9c1d5e-....png',
  })
  url: string;

  @ApiProperty({ description: 'Stored size in bytes.', example: 20481 })
  size: number;

  @ApiProperty({
    description: 'Content type detected from the file bytes.',
    example: 'image/png',
  })
  contentType: string;
}
