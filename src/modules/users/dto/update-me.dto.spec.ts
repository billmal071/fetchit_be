import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateMeDto } from './update-me.dto';
import { AdminUpdateUserDto } from './admin-update-user.dto';

/**
 * Regression test for bug #4: `PATCH /users/me` must not be able to set its
 * own `status` (an admin-only suspension control). The real enforcement is
 * the global ValidationPipe's `whitelist: true, forbidNonWhitelisted: true`
 * (main.ts) rejecting any field not declared on the target DTO class — this
 * pins that `UpdateMeDto` has no such field to whitelist, using the same
 * class-validator options the pipe is configured with.
 */
describe('UpdateMeDto', () => {
  it('rejects a status field', async () => {
    const dto = plainToInstance(UpdateMeDto, { username: 'newname', status: 'SUSPENDED' });

    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });

    expect(errors.some((e) => e.property === 'status')).toBe(true);
  });

  it('accepts its own declared fields', async () => {
    const dto = plainToInstance(UpdateMeDto, { username: 'newname', phone: '+2348012345678' });

    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });

    expect(errors).toHaveLength(0);
  });
});

describe('AdminUpdateUserDto', () => {
  it('accepts status — this is the admin-only route', async () => {
    const dto = plainToInstance(AdminUpdateUserDto, { status: 'SUSPENDED' });

    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });

    expect(errors).toHaveLength(0);
  });
});
