import { IsString, IsNotEmpty, IsEnum, IsUrl } from 'class-validator';
import { DocumentType } from '@prisma/client';

export class UploadDocumentDto {
  @IsEnum(DocumentType)
  type: DocumentType;

  @IsUrl({}, { message: 'fileUrl must be a valid URL' })
  @IsNotEmpty()
  fileUrl: string;

  @IsString()
  @IsNotEmpty()
  fileName: string;
}
