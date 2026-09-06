import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { IStorageConfig } from '@/storage';
import { HandymanController } from './handyman.controller';
import { HandymanService } from './handyman.service';

@Module({
  imports: [
    // Buffer uploads in memory: documents are small, are validated by sniffing
    // their bytes before anything is written, and the storage provider needs a
    // Buffer anyway. `files: 1` stops a caller sending a burst of parts under
    // the per-file limit.
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
  controllers: [HandymanController],
  providers: [HandymanService],
  exports: [HandymanService],
})
export class HandymanModule {}
