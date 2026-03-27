import { BadRequestException } from '@nestjs/common';
import { ParseUUIDPipe } from './parse-uuid.pipe';

describe('ParseUUIDPipe', () => {
  let pipe: ParseUUIDPipe;

  beforeEach(() => {
    pipe = new ParseUUIDPipe();
  });

  it('should pass through a valid UUID v4', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(pipe.transform(uuid)).toBe(uuid);
  });

  it('should throw BadRequestException for an invalid string', () => {
    expect(() => pipe.transform('not-a-uuid')).toThrow(BadRequestException);
    expect(() => pipe.transform('not-a-uuid')).toThrow('Invalid UUID format');
  });

  it('should throw BadRequestException for an empty string', () => {
    expect(() => pipe.transform('')).toThrow(BadRequestException);
  });

  it('should return the exact same value on success', () => {
    const uuid = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const result = pipe.transform(uuid);
    expect(result).toBe(uuid);
  });
});
