import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { IRequestUser } from '../interfaces';

export const CurrentUser = createParamDecorator(
  (data: keyof IRequestUser | undefined, ctx: ExecutionContext): IRequestUser | unknown => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as IRequestUser;
    console.log(user);

    if (data) {
      return user?.[data];
    }

    return user;
  },
);
