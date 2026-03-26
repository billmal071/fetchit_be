import { IsIn, IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DocumentStatus } from '@prisma/client';

export class ReviewDocumentDto {
  @ApiProperty({
    enum: ['APPROVED', 'REJECTED'],
    description: 'Document review status',
    example: 'APPROVED',
  })
  @IsIn([DocumentStatus.APPROVED, DocumentStatus.REJECTED], {
    message: 'Status must be APPROVED or REJECTED',
  })
  status: DocumentStatus;

  @ApiPropertyOptional({
    description: 'Reason for rejection (required if status is REJECTED)',
    example: 'Document is blurry and unreadable. Please re-upload a clear photo.',
  })
  @IsString()
  @IsOptional()
  rejectionReason?: string;
}
