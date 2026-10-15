import { describe, expect, it } from 'vitest';

import type { AppRole, Membership } from './membership';
import { effectivePermissions, hasPermission, isAdmin, PERMISSION_KEYS } from './permissions';

/**
 * Rechteauflösung je Mitgliedschaft (Rechte-Matrix, Vorschlag E21). Quelle der Regeln:
 * Bestand `is_admin_of_org`/`is_owner_of_org`, `has_permission(key)` und PermissionsService.
 */
function mitgliedschaft(optionen: {
  appRole?: AppRole;
  isOwner?: boolean;
  systemAdmin?: boolean;
  rollenRechte?: string[];
  mitgliedRechte?: string[];
}): Membership {
  return {
    isOwner: optionen.isOwner ?? false,
    orgRole: {
      id: 'role-1',
      organization_id: 'org-1',
      name: 'Rolle',
      description: null,
      is_system_admin: optionen.systemAdmin ?? false,
      is_default: false,
      permissions: optionen.rollenRechte ?? [],
      created_at: new Date(0),
      updated_at: new Date(0),
    },
    member: {
      id: 'member-1',
      organization_id: 'org-1',
      user_id: 'user-1',
      name: 'Test',
      role: null,
      department: null,
      status: 'Active',
      email: 'test@example.org',
      join_date: '2026-01-01',
      avatar_url: null,
      app_role: optionen.appRole ?? 'member',
      permissions: optionen.mitgliedRechte ?? [],
      role_id: 'role-1',
      street: null,
      zip_code: null,
      city: null,
      phone: null,
      birthday: null,
      custom_info: null,
      contact_channels: {},
      calendar_token: null,
      created_at: new Date(0),
      updated_at: new Date(0),
    },
  };
}

describe('Rechteauflösung', () => {
  it('normales Mitglied ohne Rechte hat keinen Schlüssel und ist kein Administrator', () => {
    const m = mitgliedschaft({});

    expect(isAdmin(m)).toBe(false);
    expect(effectivePermissions(m)).toEqual([]);
    expect(hasPermission(m, 'feed:create')).toBe(false);
  });

  it('Besitzer, System-Admin-Rolle und app_role admin sind Administratoren mit allen Schlüsseln', () => {
    for (const m of [
      mitgliedschaft({ isOwner: true }),
      mitgliedschaft({ systemAdmin: true }),
      mitgliedschaft({ appRole: 'admin' }),
    ]) {
      expect(isAdmin(m)).toBe(true);
      expect(effectivePermissions(m)).toEqual([...PERMISSION_KEYS]);
      expect(hasPermission(m, 'irgendein:schluessel')).toBe(true);
    }
  });

  it('committee hat alle bekannten Schlüssel, ist aber kein Administrator', () => {
    const m = mitgliedschaft({ appRole: 'committee' });

    expect(isAdmin(m)).toBe(false);
    expect(effectivePermissions(m)).toEqual([...PERMISSION_KEYS]);
  });

  it('Rollenrechte der Organisation und das Legacy-Array am Mitglied wirken additiv', () => {
    const m = mitgliedschaft({ rollenRechte: ['feed:create'], mitgliedRechte: ['wiki:edit'] });

    expect(effectivePermissions(m)).toEqual(['feed:create', 'wiki:edit']);
    expect(hasPermission(m, 'feed:approve')).toBe(false);
  });

  it('app_role public und member erhalten ohne Rollen- oder Mitgliedsrechte nichts', () => {
    expect(effectivePermissions(mitgliedschaft({ appRole: 'public' }))).toEqual([]);
    expect(effectivePermissions(mitgliedschaft({ appRole: 'member' }))).toEqual([]);
  });
});
