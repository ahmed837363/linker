import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as { tenantId?: string } | undefined;

    if (!user?.tenantId) {
      throw new ForbiddenException(
        'Tenant context is required for this operation. ' +
        'Ensure you are authenticated and associated with a tenant.',
      );
    }

    return true;
  }
}
