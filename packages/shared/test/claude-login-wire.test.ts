import { describe, expect, test } from 'vitest';
import { machineRecordSchema } from '../src/records/machine.js';
import { claudeCodeReportSchema } from '../src/records/model-source.js';

const machineBase = {
  id: 'machine-omarchy',
  name: 'omarchy',
  teamId: 'team-1',
  online: true,
  latestCliVersion: null,
  kind: 'local' as const,
  enabledRuntimes: ['pi', 'claude-code'],
  shellEnabled: false,
};

describe('Claude Code login on the machine wire', () => {
  test('presence report keeps login state and expiresAt', () => {
    const parsed = claudeCodeReportSchema.parse({
      installed: true,
      hostname: 'omarchy',
      models: [],
      login: { state: 'expiring', expiresAt: 1_700_000_000_000 },
    });
    expect(parsed.login).toEqual({ state: 'expiring', expiresAt: 1_700_000_000_000 });
  });

  test('machine record keeps claudeLogin', () => {
    const parsed = machineRecordSchema.parse({
      ...machineBase,
      claudeLogin: { state: 'expired', expiresAt: 50 },
    });
    expect(parsed.claudeLogin).toEqual({ state: 'expired', expiresAt: 50 });
  });

  test('a report without login still parses', () => {
    const parsed = claudeCodeReportSchema.parse({
      installed: true,
      hostname: 'omarchy',
      models: [],
    });
    expect(parsed.login).toBeUndefined();
  });
});
