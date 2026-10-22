import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CompleteProfileDto } from './complete-profile.dto';

const base = {
  bio: 'Experienced plumber with 5 years in residential work',
  location: 'Lagos',
  hourlyRate: 5000,
};

describe('CompleteProfileDto', () => {
  it('rejects an empty categoryIds array', async () => {
    // Bug #8: without this, an empty array passed validation, and the
    // handyman could then never apply to anything — applyToRequest's
    // category guard rejects everything with no categories to match — and
    // updateProfile only rewrites categories when the array is non-empty,
    // so there was no self-service way back in.
    const dto = plainToInstance(CompleteProfileDto, { ...base, categoryIds: [] });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'categoryIds')).toBe(true);
  });

  it('accepts a non-empty categoryIds array', async () => {
    const dto = plainToInstance(CompleteProfileDto, {
      ...base,
      categoryIds: ['550e8400-e29b-41d4-a716-446655440000'],
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});
