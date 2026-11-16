import type { MachineRecord } from '@cairn/shared';
import { describe, expect, it } from 'vitest';
import { registeredMachines } from '../src/api/hooks.js';

function machine(id: string, fields: Partial<MachineRecord>): MachineRecord {
  return {
    id,
    name: id,
    teamId: 'team-1',
    online: false,
    lastSeenAt: null,
    latestCliVersion: null,
    kind: 'remote',
    enabledRuntimes: ['pi'],
    ...fields,
  };
}

describe('registeredMachines', () => {
  it('drops the server host seat no daemon has connected to, and keeps every Runner that has', () => {
    const rows = [
      machine('seat', { kind: 'local' }),
      machine('local-was-here', { kind: 'local', lastSeenAt: 1_000 }),
      machine('local-online', { kind: 'local', online: true }),
      machine('remote-never-seen', { kind: 'remote' }),
    ];
    expect(registeredMachines(rows).map((row) => row.id)).toEqual([
      'local-was-here',
      'local-online',
      'remote-never-seen',
    ]);
  });
});
