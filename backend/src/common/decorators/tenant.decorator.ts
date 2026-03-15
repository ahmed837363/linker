import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = request.user as { tenantId?: string } | undefined;

    if (!user?.tenantId) {
      throw new Error(
        'CurrentTenant decorator requires an authenticated request with tenantId. ' +
        'Ensure the JwtAuthGuard is applied to this route.',
      );
    }

    return user.tenantId;
  },
);
