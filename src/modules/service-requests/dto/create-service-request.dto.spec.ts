import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateServiceRequestDto } from './create-service-request.dto';

const base = {
  categoryId: '550e8400-e29b-41d4-a716-446655440000',
  title: 'Fix leaking kitchen sink',
  description: 'The kitchen sink has been leaking for two days.',
  location: 'Lagos, Ikeja',
  latitude: 6.6018,
  longitude: 3.3515,
};

describe('CreateServiceRequestDto', () => {
  // Bug #14: latitude/longitude were optional and unchecked, so a request
  // could be created with no coordinates at all, making location matching
  // impossible to build reliably.
  it('rejects a missing latitude', async () => {
    const rest: Record<string, unknown> = { ...base };
    delete rest.latitude;
    const dto = plainToInstance(CreateServiceRequestDto, rest);

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'latitude')).toBe(true);
  });

  it('rejects a missing longitude', async () => {
    const rest: Record<string, unknown> = { ...base };
    delete rest.longitude;
    const dto = plainToInstance(CreateServiceRequestDto, rest);

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'longitude')).toBe(true);
  });

  it.each([-91, 91])('rejects an out-of-range latitude (%d)', async (latitude) => {
    const dto = plainToInstance(CreateServiceRequestDto, { ...base, latitude });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'latitude')).toBe(true);
  });

  it.each([-181, 181])('rejects an out-of-range longitude (%d)', async (longitude) => {
    const dto = plainToInstance(CreateServiceRequestDto, { ...base, longitude });

    const errors = await validate(dto);

    expect(errors.some((e) => e.property === 'longitude')).toBe(true);
  });

  it('accepts valid boundary coordinates', async () => {
    const dto = plainToInstance(CreateServiceRequestDto, {
      ...base,
      latitude: -90,
      longitude: 180,
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('accepts a fully valid request', async () => {
    const dto = plainToInstance(CreateServiceRequestDto, base);

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});
