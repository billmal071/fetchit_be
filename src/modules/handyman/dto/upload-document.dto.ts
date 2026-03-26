import { IsString, IsNotEmpty, IsEnum, IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { DocumentType } from '@prisma/client';

export class UploadDocumentDto {
  @ApiProperty({
    enum: ['GOVERNMENT_ID', 'SELFIE', 'PROOF_OF_ADDRESS'],
    description: 'Document type',
    example: 'GOVERNMENT_ID',
  })
  @IsEnum(DocumentType)
  type: DocumentType;

  @ApiProperty({
    description: 'URL of the uploaded document',
    example: 'https://storage.example.com/doc.pdf',
  })
  @IsUrl({}, { message: 'fileUrl must be a valid URL' })
  @IsNotEmpty()
  fileUrl: string;

  @ApiProperty({ description: 'Original file name', example: 'government-id.pdf' })
  @IsString()
  @IsNotEmpty()
  fileName: string;
}
