import { CanActivate, ExecutionContext, HttpException, Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';

import { PG_POOL } from '../infrastructure/postgres/pg.pool';

/**
 * Plattformadministration (Ersatz der fest einkodierten „Super Admin“-UUID): Das Flag `auth_users.is_platform_admin`
 * wird bei jedem Aufruf aus der Datenbank gelesen, nie aus dem Token. Muss nach JwtAuthGuard laufen.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const userId = context.switchToHttp().getRequest<{ userId?: string }>().userId;
    const { rows } = userId ? await this.pool.query<{ is_platform_admin: boolean }>('SELECT is_platform_admin FROM auth_users WHERE id = $1', [userId]) : { rows: [] };
    if (!rows[0]?.is_platform_admin) throw new HttpException({ code: 'forbidden', message: 'Keine Berechtigung' }, 403);
    return true;
  }
}
