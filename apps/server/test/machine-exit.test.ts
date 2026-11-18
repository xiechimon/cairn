import { eq, sql } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { machine as machineTable, routingRule } from '../src/db/schema.js';
import { bootServer, insertMachine, req, seedRoute } from './helpers.js';

describe('machine lifecycle exit (#1259)', () => {
  test('deleting a machine with no routing rule pinned -> 204 + row gone', async () => {
    const s = bootServer();
    const mid = insertMachine(s);
    const res = await req(s.app, 'DELETE', `/api/machines/${mid}`);
    expect(res.status).toBe(204);
    expect(s.db.select().from(machineTable).where(eq(machineTable.id, mid)).get()).toBeUndefined();
    s.dispose();
  });

  test('deleting a machine with pinned routing rules -> 204 and the rules float again', async () => {
    const s = bootServer();
    const mid = insertMachine(s);
    const sessionId = seedRoute(s, 'session', { provider: 'stub-gw', machineId: mid });
    const reviewId = seedRoute(s, 'review', { provider: 'stub-gw', machineId: mid });
    s.db.run(sql`INSERT INTO routing_rule (id, teamId, use, provider, modelId, machineId, createdAt, updatedAt)
      VALUES ('retired-checker', ${s.team.id}, 'citation_check', 'stub-gw', 'stub-model', ${mid}, 1, 1)`);
    const res = await req(s.app, 'DELETE', `/api/machines/${mid}`);
    expect(res.status).toBe(204);
    expect(s.db.select().from(machineTable).where(eq(machineTable.id, mid)).get()).toBeUndefined();
    for (const id of [sessionId, reviewId, 'retired-checker']) {
      expect(s.db.select().from(routingRule).where(eq(routingRule.id, id)).get()?.machineId).toBe(
        null,
      );
    }
    s.dispose();
  });

  test('deleting another team / nonexistent machine -> 404', async () => {
    const s = bootServer();
    const res = await req(s.app, 'DELETE', '/api/machines/machine-ghost');
    expect(res.status).toBe(404);
    s.dispose();
  });
});
