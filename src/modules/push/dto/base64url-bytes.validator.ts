import { registerDecorator, ValidationOptions } from 'class-validator';

/** Unpadded base64url string that decodes to exactly `exact` bytes, or at least `min` bytes. */
export function IsBase64UrlBytes(
  bytes: { exact: number } | { min: number },
  options?: ValidationOptions,
): PropertyDecorator {
  return (object, propertyName) => {
    registerDecorator({
      name: 'isBase64UrlBytes',
      target: object.constructor,
      propertyName: propertyName as string,
      options,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
          if (value.length % 4 === 1) return false;
          const length = Buffer.from(value, 'base64url').length;
          return 'exact' in bytes ? length === bytes.exact : length >= bytes.min;
        },
        defaultMessage(args): string {
          const need = 'exact' in bytes ? `exactly ${bytes.exact}` : `at least ${bytes.min}`;
          return `${args?.property} must be unpadded base64url decoding to ${need} bytes`;
        },
      },
    });
  };
}
