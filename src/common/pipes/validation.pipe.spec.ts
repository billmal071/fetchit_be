import { BadRequestException } from '@nestjs/common';
import { IsString, IsNotEmpty } from 'class-validator';
import { CustomValidationPipe } from './validation.pipe';

class TestDto {
  @IsString()
  @IsNotEmpty()
  name: string;
}

describe('CustomValidationPipe', () => {
  let pipe: CustomValidationPipe;

  beforeEach(() => {
    pipe = new CustomValidationPipe();
  });

  it('should return value unchanged when metatype is String', async () => {
    const result = await pipe.transform('hello', { metatype: String, type: 'body' });
    expect(result).toBe('hello');
  });

  it('should return value unchanged when metatype is undefined', async () => {
    const result = await pipe.transform({ foo: 1 }, { metatype: undefined, type: 'body' });
    expect(result).toEqual({ foo: 1 });
  });

  it('should validate and return transformed DTO on valid input', async () => {
    const result = await pipe.transform({ name: 'test' }, { metatype: TestDto, type: 'body' });
    expect(result).toBeInstanceOf(TestDto);
    expect((result as TestDto).name).toBe('test');
  });

  it('should throw BadRequestException with formatted errors for invalid DTO', async () => {
    try {
      await pipe.transform({ name: '' }, { metatype: TestDto, type: 'body' });
      fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as Record<string, unknown>;
      expect(response.message).toBe('Validation failed');
      const details = response.details as Array<{ field: string; message: string }>;
      expect(details[0].field).toBe('name');
    }
  });

  it('should include field, message, and value in error details', async () => {
    try {
      await pipe.transform({ name: 123 }, { metatype: TestDto, type: 'body' });
      fail('Should have thrown');
    } catch (error) {
      const response = (error as BadRequestException).getResponse() as Record<string, unknown>;
      const details = response.details as Array<{ field: string; message: string; value: unknown }>;
      expect(details[0]).toHaveProperty('field');
      expect(details[0]).toHaveProperty('message');
      expect(details[0]).toHaveProperty('value');
    }
  });

  it('should reject non-whitelisted properties', async () => {
    await expect(
      pipe.transform(
        { name: 'test', extra: 'should-be-rejected' },
        { metatype: TestDto, type: 'body' },
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
