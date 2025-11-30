import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { REGEX_PATTERNS } from '../constants';

@Injectable()
export class ParseUUIDPipe implements PipeTransform<string> {
  transform(value: string): string {
    if (!REGEX_PATTERNS.UUID.test(value)) {
      throw new BadRequestException('Invalid UUID format');
    }
    return value;
  }
}
