import { PartialType } from '@nestjs/swagger';
import { CompleteProfileDto } from './complete-profile.dto';

export class UpdateProfileDto extends PartialType(CompleteProfileDto) {}
