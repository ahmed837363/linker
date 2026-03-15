import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = request.user;

    if (!user) {
      throw new Error(
        'CurrentUser decorator requires an authenticated request. ' +
        'Ensure the JwtAuthGuard is applied to this route.',
      );
    }

    // If a specific property is requested, return just that property
    if (data) {
      return (user as Record<string, unknown>)[data];
    }

    return user;
  },
);
