import { Body, Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UploadsService } from './uploads.service';
import { UploadFileDto, UploadedFileResponseDto } from './dto';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { ApiCreatedSuccessResponse, ApiErrorResponses } from '@/common/decorators';
import { IRequestUser, IUploadedFile } from '@common/interfaces';
import { IStoredObject } from '@/storage';

@ApiTags('Uploads')
@Controller('uploads')
@ApiBearerAuth()
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a file to object storage',
    description:
      'Stores a file and returns its URL, for the routes that persist a URL rather than the bytes ' +
      '(avatars via PATCH /users/me, shopping receipts). Accepts PDF, JPEG, PNG and WebP up to 5 MB. ' +
      'The declared filename and content type are ignored — the type is determined from the file bytes ' +
      "and the storage key is generated server-side under the caller's user id. Handyman verification " +
      'documents use POST /handyman/documents/upload instead, which also records the document.',
  })
  @ApiBody({ type: UploadFileDto })
  @ApiCreatedSuccessResponse(UploadedFileResponseDto)
  @ApiErrorResponses()
  async upload(
    @CurrentUser() user: IRequestUser,
    @Body() dto: UploadFileDto,
    @UploadedFile() file: IUploadedFile | undefined,
  ): Promise<{ data: IStoredObject; message: string }> {
    const data = await this.uploadsService.upload(user.id, dto.purpose, file);
    return { data, message: 'File uploaded successfully' };
  }
}
