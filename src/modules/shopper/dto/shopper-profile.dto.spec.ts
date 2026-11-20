import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  OnboardShopperDto,
  SetAvailabilityDto,
  UpdateShopperProfileDto,
} from './shopper-profile.dto';

const CAT = '550e8400-e29b-41d4-a716-446655440001';
const LOC = '550e8400-e29b-41d4-a716-446655440002';

const valid = {
  displayName: 'Amaka O.',
  bio: 'Six years buying for restaurants around Mile 12.',
  categoryIds: [CAT],
  locationIds: [LOC],
};

const failing = async (cls: new () => object, payload: object): Promise<string[]> =>
  (await validate(plainToInstance(cls, payload))).map((error) => error.property);

describe('OnboardShopperDto', () => {
  it('accepts the documented minimal payload', async () => {
    expect(await failing(OnboardShopperDto, valid)).toEqual([]);
  });

  it('accepts the full payload from the spec', async () => {
    expect(
      await failing(OnboardShopperDto, {
        ...valid,
        phone: '+2348012345678',
        yearsOfExperience: 6,
        serviceIds: ['550e8400-e29b-41d4-a716-446655440003'],
        availability: [
          { weekday: 'MONDAY' },
          { weekday: 'SATURDAY', startTime: '08:00', endTime: '18:00' },
        ],
      }),
    ).toEqual([]);
  });

  it('requires displayName, bio, categoryIds and locationIds', async () => {
    expect((await failing(OnboardShopperDto, {})).sort()).toEqual(
      ['bio', 'categoryIds', 'displayName', 'locationIds'].sort(),
    );
  });

  it('requires a bio of at least 10 characters', async () => {
    expect(await failing(OnboardShopperDto, { ...valid, bio: 'too short' })).toContain('bio');
  });

  it.each(['categoryIds', 'locationIds'])('requires at least one entry in %s', async (field) => {
    expect(await failing(OnboardShopperDto, { ...valid, [field]: [] })).toContain(field);
  });

  it('rejects duplicate ids', async () => {
    expect(await failing(OnboardShopperDto, { ...valid, categoryIds: [CAT, CAT] })).toContain(
      'categoryIds',
    );
  });

  it('rejects labels where ids are expected', async () => {
    // The first FE build sent taxonomy labels ('Food & Groceries', 'ALL') in
    // place of ids; the API takes ids from GET /shopper/categories etc.
    expect(
      await failing(OnboardShopperDto, { ...valid, categoryIds: ['Food & Groceries'] }),
    ).toContain('categoryIds');
    expect(await failing(OnboardShopperDto, { ...valid, serviceIds: ['ALL'] })).toContain(
      'serviceIds',
    );
  });

  it('ignores spaces, hyphens and brackets in the phone number', async () => {
    const dto = plainToInstance(OnboardShopperDto, { ...valid, phone: '+234 (801) 234-5678' });

    expect(await validate(dto)).toEqual([]);
    expect(dto.phone).toBe('+2348012345678');
  });

  it('rejects a phone number that is not digits', async () => {
    expect(await failing(OnboardShopperDto, { ...valid, phone: 'call me' })).toContain('phone');
  });

  it('rejects an unknown weekday and a malformed time', async () => {
    expect(
      await failing(OnboardShopperDto, { ...valid, availability: [{ weekday: 'FUNDAY' }] }),
    ).toContain('availability');
    expect(
      await failing(OnboardShopperDto, {
        ...valid,
        availability: [{ weekday: 'MONDAY', startTime: '8am', endTime: '25:00' }],
      }),
    ).toContain('availability');
  });

  it('rejects more than seven availability slots', async () => {
    const slots = Array.from({ length: 8 }, () => ({ weekday: 'MONDAY' }));

    expect(await failing(OnboardShopperDto, { ...valid, availability: slots })).toContain(
      'availability',
    );
  });
});

describe('UpdateShopperProfileDto', () => {
  it('accepts an empty patch', async () => {
    expect(await failing(UpdateShopperProfileDto, {})).toEqual([]);
  });

  it('never allows a relation set to be emptied', async () => {
    expect(await failing(UpdateShopperProfileDto, { categoryIds: [] })).toContain('categoryIds');
    expect(await failing(UpdateShopperProfileDto, { locationIds: [] })).toContain('locationIds');
  });

  it('still validates the fields it is given', async () => {
    expect(await failing(UpdateShopperProfileDto, { bio: 'short' })).toContain('bio');
    expect(await failing(UpdateShopperProfileDto, { displayName: '' })).toContain('displayName');
  });
});

describe('SetAvailabilityDto', () => {
  it('needs a boolean', async () => {
    expect(await failing(SetAvailabilityDto, { isOnline: true })).toEqual([]);
    expect(await failing(SetAvailabilityDto, { isOnline: 'yes' })).toContain('isOnline');
    expect(await failing(SetAvailabilityDto, {})).toContain('isOnline');
  });
});

describe('with the production validation pipe', () => {
  // main.ts enables implicit conversion, which changes what a DTO receives.
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });
  const run = (metatype: new () => object, body: unknown): Promise<unknown> =>
    pipe.transform(body, { type: 'body', metatype });

  describe('SetAvailabilityDto', () => {
    it.each([true, false])('accepts a real JSON %s', async (isOnline) => {
      await expect(run(SetAvailabilityDto, { isOnline })).resolves.toEqual({ isOnline });
    });

    it.each(['false', 'true', '0', '1', 'no', 'yes', '', 0, 1, null])(
      'rejects %j, which implicit conversion would otherwise turn into a boolean',
      async (isOnline) => {
        // Boolean("false") is true: without reading the raw value, a shopper
        // asking to go OFFLINE would be put online.
        await expect(run(SetAvailabilityDto, { isOnline })).rejects.toBeDefined();
      },
    );
  });

  describe('availability times', () => {
    const body = (slot: object): object => ({ ...valid, availability: [slot] });

    it('treats an explicit null time as no time', async () => {
      const out = (await run(
        OnboardShopperDto,
        body({ weekday: 'MONDAY', startTime: null, endTime: null }),
      )) as OnboardShopperDto;

      expect(out.availability?.[0].startTime).toBeUndefined();
      expect(out.availability?.[0].endTime).toBeUndefined();
    });

    it('turns a null start into a missing one, so the pairing check can catch it', async () => {
      const out = (await run(
        OnboardShopperDto,
        body({ weekday: 'MONDAY', startTime: null, endTime: '18:00' }),
      )) as OnboardShopperDto;

      expect(out.availability?.[0].startTime).toBeUndefined();
      expect(out.availability?.[0].endTime).toBe('18:00');
    });
  });
});

describe('clearing the optional sets', () => {
  // Categories and locations can never be emptied; extra services and working
  // days are optional, so an empty array is how a shopper clears them.
  it.each(['serviceIds', 'availability'])('accepts [] for %s on update', async (field) => {
    expect(await failing(UpdateShopperProfileDto, { [field]: [] })).toEqual([]);
  });

  it.each(['serviceIds', 'availability'])('accepts [] for %s on onboarding', async (field) => {
    expect(await failing(OnboardShopperDto, { ...valid, [field]: [] })).toEqual([]);
  });
});
