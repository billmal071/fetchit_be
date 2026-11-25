import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsISO8601, Matches } from 'class-validator';

/**
 * A decision applies to the submission the reviewer loaded, identified by the
 * `submittedAt` the review endpoints return. If the shopper resubmitted since,
 * the decision is refused (409) rather than landing on data nobody reviewed.
 */
export class ApproveShopperDto {
  @ApiProperty({
    description:
      'The `submittedAt` of the application as you loaded it (from the list or detail endpoint), unchanged.',
    example: '2026-11-20T10:00:00.000Z',
    format: 'date-time',
  })
  // Read from the raw body so the global pipe's implicit conversion cannot
  // coerce a number or object into a string before the validator sees it.
  @Transform(({ obj }: { obj: { submittedAt?: unknown } }) => obj.submittedAt)
  @IsISO8601({ strict: true, strictSeparator: true })
  // A full instant: a time and an explicit zone, so it cannot be read as local time.
  @Matches(/T\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/i, {
    message:
      'submittedAt must be an ISO 8601 date-time with a time zone, e.g. 2026-11-20T10:00:00.000Z',
  })
  submittedAt: string;
}
