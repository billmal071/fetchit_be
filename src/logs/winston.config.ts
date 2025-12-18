import * as winston from 'winston';
import { utilities as nestWinstonModuleUtilities } from 'nest-winston';

const isProduction = process.env.NODE_ENV === 'production';

export const winstonConfig = {
  transports: [
    new winston.transports.Console({
      level: isProduction ? 'info' : 'debug',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.ms(),
        nestWinstonModuleUtilities.format.nestLike('FetchIt', {
          colors: !isProduction,
          prettyPrint: !isProduction,
        }),
      ),
    }),
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    }),
  ],
};
