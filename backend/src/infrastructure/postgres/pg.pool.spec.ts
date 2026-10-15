import { describe, expect, it } from 'vitest';

import { createPgPool } from './pg.pool';

describe('createPgPool', () => {
  it('überlebt den Verlust einer Leerlauf-Verbindung (DB-Neustart) statt den Prozess zu beenden', async () => {
    const pool = createPgPool('postgres://u:p@127.0.0.1:1/db', 2);

    // pg meldet getrennte Leerlauf-Clients als „error“ des Pools; ohne Listener wirft emit() und der Prozess stürzt ab.
    expect(() => pool.emit('error', new Error('terminating connection due to administrator command'))).not.toThrow();

    await pool.end();
  });
});
