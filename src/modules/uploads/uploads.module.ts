import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { IStorageConfig } from '@/storage';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Module({
  imports: [
    // Same posture as HandymanModule: buffer in memory, cap the size from
    // configuration, and allow a single file per request so a caller cannot
    // send a burst of parts that each sit under the per-file limit.
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const storageConfig = configService.get<IStorageConfig>('storage');
        return {
          storage: memoryStorage(),
          limits: {
            fileSize: storageConfig?.maxFileSize ?? 5 * 1024 * 1024,
            files: 1,
          },
        };
      },
    }),
  ],
  controllers: [UploadsController],
  providers: [UploadsService],
  exports: [UploadsService],
})
export class UploadsModule {}
