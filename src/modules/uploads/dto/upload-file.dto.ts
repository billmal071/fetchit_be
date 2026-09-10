import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * What a file is being uploaded for.
 *
 * The purpose selects the storage prefix, so it is a closed enum rather than a
 * free-text field: a client must never be able to choose where its bytes land.
 * Handyman verification documents are deliberately absent — those go through
 * `POST /handyman/documents/upload`, which also records the document row.
 */
export enum UploadPurpose {
  AVATAR = 'AVATAR',
  RECEIPT = 'RECEIPT',
}

/** Storage prefix for each purpose. Server-controlled, never client-supplied. */
export const UPLOAD_PURPOSE_PREFIX: Readonly<Record<UploadPurpose, string>> = {
  [UploadPurpose.AVATAR]: 'avatars',
  [UploadPurpose.RECEIPT]: 'receipts',
};

/** Multipart body for `POST /uploads`. */
export class UploadFileDto {
  @ApiProperty({
    enum: UploadPurpose,
    description: 'What the file is for. Determines the storage prefix.',
    example: UploadPurpose.AVATAR,
  })
  @IsEnum(UploadPurpose)
  purpose: UploadPurpose;

  @ApiProperty({
    type: 'string',
    format: 'binary',
    description:
      'The file itself (PDF, JPEG, PNG or WebP; maximum set by STORAGE_MAX_FILE_SIZE, default 5 MB)',
  })
  file: unknown;
}
