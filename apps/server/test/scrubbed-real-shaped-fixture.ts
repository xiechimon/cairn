import { machine as machineTable } from '../src/db/schema.js';
import { newRecordId } from '../src/lib/ids.js';
import { insertClaudeSubscription, type TestServer } from './helpers.js';

const DAY = 24 * 60 * 60 * 1000;

export function seedScrubbedRealShapedWorld(
  s: TestServer,
  now = Date.now(),
): { activeRunnerIds: string[]; retiredRunnerId: string; expiredSubscriptionId: string } {
  const capabilities = {
    mcpServers: [],
    skills: [],
    osPlatform: 'darwin' as const,
    claimGeneration: true as const,
    runnerProtocolVersion: 1,
  };
  const rows = [
    { id: 'runner-mac-studio', name: 'studio-mac.local', kind: 'local', online: true },
    { id: 'runner-mac-mini', name: 'mac-mini', kind: 'remote', online: true },
    { id: 'runner-retired-laptop', name: 'old-laptop', kind: 'remote', online: false },
  ];
  for (const row of rows) {
    s.db
      .insert(machineTable)
      .values({
        id: row.id,
        teamId: s.team.id,
        name: row.name,
        kind: row.kind,
        online: row.online,
        tokenHash: row.id === 'runner-retired-laptop' ? null : `scrubbed-${row.id}`,
        lastSeenAt: now - (row.online ? 30_000 : 12 * DAY),
        capabilities,
        hostKey: `scrubbed-host-key-${row.id}`,
        retiredAt: row.id === 'runner-retired-laptop' ? now - 3 * DAY : null,
      })
      .run();
  }
  const expiredSubscriptionId = insertClaudeSubscription(s, {
    label: 'Old laptop subscription',
    expiresAt: now - 2 * DAY,
  });
  return {
    activeRunnerIds: rows.slice(0, 2).map((row) => row.id),
    retiredRunnerId: 'runner-retired-laptop',
    expiredSubscriptionId,
  };
}

export function newScrubbedId(prefix: string): string {
  return `${prefix}-${newRecordId()}`;
}
