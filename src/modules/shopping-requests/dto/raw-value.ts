import { Transform, TransformFnParams } from 'class-transformer';

/**
 * The global ValidationPipe runs with enableImplicitConversion, which turns
 * `"4500"` into 4500, `true` into 1 and `[]` into 0 before validators see them.
 * For money and quantities that would let a wrong type through as a valid
 * number, so this puts the raw body value back and lets IsInt/IsString decide.
 */
export const RawValue = (): PropertyDecorator =>
  Transform(({ obj, key }: TransformFnParams) => (obj as Record<string, unknown>)[key]);

/**
 * Like RawValue, and trims a string. Whitespace-only input becomes '' so
 * IsNotEmpty rejects it; non-strings pass through untouched for IsString to reject.
 */
export const TrimmedValue = (): PropertyDecorator =>
  Transform(({ obj, key }: TransformFnParams) => {
    const raw = (obj as Record<string, unknown>)[key];
    return typeof raw === 'string' ? raw.trim() : raw;
  });
