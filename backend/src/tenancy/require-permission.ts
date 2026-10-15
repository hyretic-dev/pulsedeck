import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { hasPermission, isAdmin } from './permissions';
import type { OrgRequest } from './org.guard';

const PERMISSION_METADATA = 'tenancy:permission';
const ADMIN_METADATA = 'tenancy:admin';

/** Verlangt die Berechtigung `key` in der Organisation des Pfads (nach OrgGuard). */
export const RequirePermission = (key: string) => SetMetadata(PERMISSION_METADATA, key);

/** Verlangt Administratorrechte in der Organisation des Pfads (nach OrgGuard). */
export const RequireAdmin = () => SetMetadata(ADMIN_METADATA, true);

/**
 * Prüft `@RequirePermission` / `@RequireAdmin` gegen die vom OrgGuard geladene Mitgliedschaft.
 * Fehlt die Mitgliedschaft (OrgGuard vergessen), wird abgelehnt statt durchgelassen.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const ziele = [context.getHandler(), context.getClass()];
    const schluessel = this.reflector.getAllAndOverride<string | undefined>(PERMISSION_METADATA, ziele);
    const adminNoetig = this.reflector.getAllAndOverride<boolean | undefined>(ADMIN_METADATA, ziele);
    const membership = context.switchToHttp().getRequest<OrgRequest>().membership;

    if (!membership) {
      throw new HttpException({ code: 'forbidden', message: 'Keine Berechtigung' }, 403);
    }
    if (adminNoetig && !isAdmin(membership)) {
      throw new HttpException({ code: 'forbidden', message: 'Keine Berechtigung' }, 403);
    }
    if (schluessel && !hasPermission(membership, schluessel)) {
      throw new HttpException({ code: 'forbidden', message: 'Keine Berechtigung' }, 403);
    }
    return true;
  }
}
