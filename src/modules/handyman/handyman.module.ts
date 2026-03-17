import { Module } from '@nestjs/common';
import { HandymanController } from './handyman.controller';
import { HandymanService } from './handyman.service';

@Module({
  controllers: [HandymanController],
  providers: [HandymanService],
  exports: [HandymanService],
})
export class HandymanModule {}
