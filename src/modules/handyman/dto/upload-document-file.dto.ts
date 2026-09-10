import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { DocumentType } from '@prisma/client';

/**
 * Multipart body for `POST /handyman/documents/upload`.
 *
 * Only `type` is trusted from the client. The file's name and MIME type are
 * ignored in favour of sniffing the bytes, and the storage key is generated
 * server-side.
 */
export class UploadDocumentFileDto {
  @ApiProperty({
    enum: ['GOVERNMENT_ID', 'SELFIE', 'PROOF_OF_ADDRESS'],
    description: 'Document type',
    example: 'GOVERNMENT_ID',
  })
  @IsEnum(DocumentType)
  type: DocumentType;

  @ApiProperty({
    type: 'string',
    format: 'binary',
    description:
      'The document itself (PDF, JPEG, PNG or WebP; maximum set by STORAGE_MAX_FILE_SIZE, default 5 MB)',
  })
  file: unknown;
}
