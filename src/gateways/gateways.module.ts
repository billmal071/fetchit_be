import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventsGateway } from './events.gateway';
import { IJwtConfig } from '@/config';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const jwtConfig = configService.get<IJwtConfig>('jwt');
        return {
          secret: jwtConfig?.secret,
        };
      },
    }),
  ],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class GatewaysModule {}
