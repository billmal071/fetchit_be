import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApproveShopperDto } from './approve-shopper.dto';

export class RejectShopperDto extends ApproveShopperDto {
  @ApiProperty({
    description: 'What the shopper needs to fix. Shown to them; they can then resubmit.',
    example: 'Please add at least one market you know well.',
    maxLength: 1000,
  })
  // Trimmed first, so a reason of only spaces counts as empty. Reads the raw
  // body value: the global pipe's implicit conversion would otherwise turn a
  // number or object into a string before @IsString could refuse it.
  @Transform(({ obj }: { obj: { reason?: unknown } }) =>
    typeof obj.reason === 'string' ? obj.reason.trim() : obj.reason,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;
}
