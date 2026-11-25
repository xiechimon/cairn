import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { claudeSubscription, machine as machineTable } from '../src/db/schema.js';
import { bootServer } from './helpers.js';
import { seedScrubbedRealShapedWorld } from './scrubbed-real-shaped-fixture.js';

describe('the scrubbed real-shaped server fixture', () => {
  test('carries two active runners, one retired row, an expired subscription, and remote mode', () => {
    const s = bootServer({
      remote: {
        tailnetStatus: () => ({
          enabled: true,
          state: 'ready',
          dnsName: 'cairn.example.ts.net',
          ips: ['100.64.0.1'],
          authUrl: null,
          error: null,
        }),
      },
    });
    try {
      const seeded = seedScrubbedRealShapedWorld(s);
      const active = s.db
        .select()
        .from(machineTable)
        .where(and(isNull(machineTable.retiredAt), isNotNull(machineTable.tokenHash)))
        .all();
      const retired = s.db
        .select()
        .from(machineTable)
        .where(eq(machineTable.id, seeded.retiredRunnerId))
        .get();
      const expired = s.db
        .select()
        .from(claudeSubscription)
        .where(eq(claudeSubscription.id, seeded.expiredSubscriptionId))
        .get();
      expect(active.map((row) => row.id).sort()).toEqual(seeded.activeRunnerIds.sort());
      expect(retired?.retiredAt).not.toBeNull();
      expect(retired?.tokenHash).toBeNull();
      expect(expired?.expiresAt).toBeLessThan(Date.now());
      expect(s.app).toBeDefined();
    } finally {
      s.dispose();
    }
  });
});
