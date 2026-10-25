import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import { machine as machineTable } from '../src/db/schema.js';
import { backfillMachineConcurrency } from '../src/services/machines.js';
import { bootServer } from './helpers.js';

const s = bootServer();
afterAll(() => s.dispose());

const hw = {
  cpuCores: 12,
  memoryTotalMb: 36 * 1024,
  memoryAvailableMb: 20_000,
  loadAvg1: 0.5,
  diskFreeMb: 100_000,
};

function insert(id: string, maxConcurrent: number, overridden: boolean, withHardware: boolean) {
  s.db
    .insert(machineTable)
    .values({
      id,
      teamId: s.team.id,
      name: id,
      online: false,
      tokenHash: null,
      apiKeyId: null,
      latestCliVersion: null,
      kind: 'remote',
      maxConcurrent,
      maxConcurrentOverridden: overridden,
      capabilities: withHardware ? { mcpServers: [], skills: [], hardware: hw } : null,
    })
    .run();
}
const get = (id: string) => s.db.select().from(machineTable).where(eq(machineTable.id, id)).get()!;

describe('#1241 backfillMachineConcurrency', () => {
  test('B1-B4: legacy default 3 follows the recommendation, no fingerprint stays 3, manual override untouched, rerun zero change', () => {
    insert('legacy-hw', 3, false, true);
    insert('legacy-blank', 3, false, false);
    insert('manual-3', 3, true, true);
    insert('manual-5', 5, true, true);

    const changed = backfillMachineConcurrency(s.db);
    expect(get('legacy-hw')).toMatchObject({ maxConcurrent: 12, maxConcurrentOverridden: false });
    expect(get('legacy-blank')).toMatchObject({ maxConcurrent: 3, maxConcurrentOverridden: false });
    expect(get('manual-3')).toMatchObject({ maxConcurrent: 3, maxConcurrentOverridden: true });
    expect(get('manual-5')).toMatchObject({ maxConcurrent: 5, maxConcurrentOverridden: true });
    expect(changed).toBe(1);

    expect(backfillMachineConcurrency(s.db)).toBe(0);
    expect(get('legacy-hw').maxConcurrent).toBe(12);
  });
});
