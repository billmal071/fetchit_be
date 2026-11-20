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
