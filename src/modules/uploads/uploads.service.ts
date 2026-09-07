import { randomUUID } from 'crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { StorageService, IStoredObject } from '@/storage';
import { ALLOWED_UPLOAD_MIME_TYPES, sniffFileType } from '@common/utils/file-type.util';
import { IUploadedFile } from '@common/interfaces';
import { UploadPurpose, UPLOAD_PURPOSE_PREFIX } from './dto';

/**
 * Uploads Service
 *
 * Turns a multipart file into a stored object and hands back its URL. This is
 * the generic seam for anything that only needs a hosted file — avatars
 * (`PATCH /users/me`) and shopping receipts — so those flows no longer depend
 * on a third-party upload host.
 *
 * Nothing the client declares about the file is trusted: the content type comes
 * from sniffing the bytes and the storage key is generated here, prefixed by
 * the caller's own user id.
 */
@Injectable()
export class UploadsService {
  constructor(private readonly storage: StorageService) {}

  async upload(
    userId: string,
    purpose: UploadPurpose,
    file: IUploadedFile | undefined,
  ): Promise<IStoredObject> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('A file is required under the "file" field');
    }

    const sniffed = sniffFileType(file.buffer);
    if (!sniffed) {
      throw new BadRequestException(
        `Unsupported file type. Allowed types: ${ALLOWED_UPLOAD_MIME_TYPES.join(', ')}`,
      );
    }

    const key = `${UPLOAD_PURPOSE_PREFIX[purpose]}/${userId}/${randomUUID()}.${sniffed.extension}`;

    return this.storage.upload({
      key,
      body: file.buffer,
      contentType: sniffed.mimeType,
    });
  }
}
