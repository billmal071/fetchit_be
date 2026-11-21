import { ApiProperty } from '@nestjs/swagger';

export class NotificationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'shopper.approved', description: 'Machine-readable kind' })
  type: string;

  @ApiProperty({ example: 'Application approved' })
  title: string;

  @ApiProperty({ type: String, nullable: true })
  body: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '/shopper',
    description: 'In-app path to open (always starts with a single "/")',
  })
  href: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Optional structured payload',
  })
  data: Record<string, unknown> | null;

  @ApiProperty()
  read: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readAt: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: string;
}

export class UnreadCountResponseDto {
  @ApiProperty({ example: 3 })
  count: number;
}

export class ReadAllResponseDto {
  @ApiProperty({ example: 3, description: 'How many notifications were newly marked read' })
  updated: number;
}
