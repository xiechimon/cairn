import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import {
  build as buildTable,
  externalEffect,
  machine as machineTable,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import {
  cancelScopeEffects,
  claimEffect,
  createEffectRegistry,
  drainEffects,
  EFFECT_CLAIM_STALE_MS,
  type EffectRow,
  effectDedupeKey,
  failEffect,
  reconcileEffects,
  recordEffect,
  retryEffect,
  runEffectRow,
  settleEffectRow,
} from '../src/services/external-effects.js';
import { claimStep, type MachineDeps } from '../src/services/machines.js';
import { bootServer, seedSessionRoute, type TestServer } from './helpers.js';

let s: TestServer;

beforeEach(() => {
  s = bootServer({ vapidKeys: null });
});

afterEach(() => {
  s.dispose();
});

const intent = (dedupeKey: string, overrides: Record<string, unknown> = {}) => ({
  teamId: s.team.id,
  scopeKind: 'todo' as const,
  scopeId: 'todo-1',
  kind: 'test-kind',
  dedupeKey,
  payload: { text: 'hello' },
  ...overrides,
});

const rowById = (id: string): EffectRow => {
  const row = s.db.select().from(externalEffect).where(eq(externalEffect.id, id)).get();
  if (row === undefined) throw new Error(`expected effect row ${id}`);
  return row;
};

const staleSending = (id: string): void => {
  const fence = Date.now() - EFFECT_CLAIM_STALE_MS - 1_000;
  s.db
    .update(externalEffect)
    .set({ state: 'sending', claimedAt: fence, claimFence: fence })
    .where(eq(externalEffect.id, id))
    .run();
};

describe('recordEffect', () => {
  test('a repeated intent attaches to the existing row instead of inserting a second', () => {
    const key = effectDedupeKey('k', 'a', 1);
    const first = recordEffect(s.db, intent(key));
    const second = recordEffect(s.db, intent(key, { payload: { text: 'different' } }));
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.row.id).toBe(first.row.id);
    expect(s.db.select().from(externalEffect).all()).toHaveLength(1);
  });

  test('distinct dedupe keys produce distinct rows', () => {
    recordEffect(s.db, intent(effectDedupeKey('k', 'a')));
    recordEffect(s.db, intent(effectDedupeKey('k', 'b')));
    expect(s.db.select().from(externalEffect).all()).toHaveLength(2);
  });
});

describe('runEffectRow and drainEffects', () => {
  test('a pending row is claimed, sent once, and stored delivered with the receipt', async () => {
    const sent: string[] = [];
    const registry = createEffectRegistry();
    registry.set('test-kind', {
      policy: 'unsafe',
      send: async (row) => {
        sent.push(row.id);
        return { ok: true };
      },
    });
    const { row } = recordEffect(s.db, intent(effectDedupeKey('k', 'one')));
    await drainEffects(s.db, registry);
    const stored = rowById(row.id);
    expect(sent).toEqual([row.id]);
    expect(stored.state).toBe('delivered');
    expect(stored.receipt).toEqual({ ok: true });
    await drainEffects(s.db, registry);
    expect(sent).toHaveLength(1);
  });

  test('a retryable failure returns to pending with a future dueAt and is not redrained early', async () => {
    let calls = 0;
    const registry = createEffectRegistry();
    registry.set('test-kind', {
      policy: 'unsafe',
      send: async () => {
        calls += 1;
        throw retryEffect('try later');
      },
    });
    const { row } = recordEffect(s.db, intent(effectDedupeKey('k', 'retry')));
    const now = Date.now();
    expect(await runEffectRow(s.db, registry, row.id, now)).toBe('pending');
    const stored = rowById(row.id);
    expect(stored.state).toBe('pending');
    expect(stored.dueAt).toBeGreaterThan(now);
    expect(stored.attempts).toBe(1);
    expect(stored.lastError).toBe('try later');
    await drainEffects(s.db, registry, { now });
    expect(calls).toBe(1);
  });

  test('a permanent failure parks the row as failed', async () => {
    const registry = createEffectRegistry();
    registry.set('test-kind', {
      policy: 'unsafe',
      send: async () => {
        throw failEffect('refused');
      },
    });
    const { row } = recordEffect(s.db, intent(effectDedupeKey('k', 'fail')));
    expect(await runEffectRow(s.db, registry, row.id)).toBe('failed');
    expect(rowById(row.id).state).toBe('failed');
  });

  test('a kind is reported once after three consecutive failures and re-arms on success', async () => {
    const writes: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);
    try {
      let up = false;
      const registry = createEffectRegistry();
      registry.set('test-kind', {
        policy: 'unsafe',
        send: async () => {
          if (!up) throw retryEffect('down');
          return { ok: true };
        },
      });
      const failing = (n: number) =>
        recordEffect(s.db, intent(effectDedupeKey('k', `f${n}`))).row.id;
      for (let n = 0; n < 2; n += 1) await runEffectRow(s.db, registry, failing(n));
      expect(writes.filter((w) => w.includes('EXTERNAL EFFECT KIND FAILING'))).toHaveLength(0);
      await runEffectRow(s.db, registry, failing(2));
      expect(writes.filter((w) => w.includes('test-kind'))).toHaveLength(1);
      await runEffectRow(s.db, registry, failing(3));
      expect(writes.filter((w) => w.includes('test-kind'))).toHaveLength(1);
      up = true;
      const { row } = recordEffect(s.db, intent(effectDedupeKey('k', 'ok')));
      expect(await runEffectRow(s.db, registry, row.id)).toBe('delivered');
      up = false;
      for (let n = 4; n < 7; n += 1) await runEffectRow(s.db, registry, failing(n));
      expect(writes.filter((w) => w.includes('test-kind'))).toHaveLength(2);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('reconcile after a crash', () => {
  test('an unsafe stale sending row is interrupted and the send is never re-run', async () => {
    let calls = 0;
    const registry = createEffectRegistry();
    registry.set('test-kind', {
      policy: 'unsafe',
      send: async () => {
        calls += 1;
        return {};
      },
    });
    const { row } = recordEffect(s.db, intent(effectDedupeKey('k', 'unsafe')));
    staleSending(row.id);
    const tally = await reconcileEffects(s.db, registry);
    expect(tally.interrupted).toBe(1);
    expect(rowById(row.id).state).toBe('interrupted');
    await drainEffects(s.db, registry);
    expect(calls).toBe(0);
  });

  test('a probe kind settles a crashed send as delivered without re-sending', async () => {
    let calls = 0;
    const registry = createEffectRegistry();
    registry.set('test-kind', {
      policy: 'probe',
      send: async () => {
        calls += 1;
        return {};
      },
      probe: async () => ({ verdict: 'delivered', receipt: { remote: 42 } }),
    });
    const { row } = recordEffect(s.db, intent(effectDedupeKey('k', 'probe-hit')));
    staleSending(row.id);
    const tally = await reconcileEffects(s.db, registry);
    expect(tally.probed).toBe(1);
    const stored = rowById(row.id);
    expect(stored.state).toBe('delivered');
    expect(stored.receipt).toEqual({ remote: 42 });
    await drainEffects(s.db, registry);
    expect(calls).toBe(0);
  });

  test('a probe miss requeues the row and the drain sends it once', async () => {
    let calls = 0;
    const registry = createEffectRegistry();
    registry.set('test-kind', {
      policy: 'probe',
      send: async () => {
        calls += 1;
        return { n: calls };
      },
      probe: async () => ({ verdict: 'unsent' }),
    });
    const { row } = recordEffect(s.db, intent(effectDedupeKey('k', 'probe-miss')));
    staleSending(row.id);
    const tally = await reconcileEffects(s.db, registry);
    expect(tally.requeued).toBe(1);
    expect(rowById(row.id).state).toBe('pending');
    await drainEffects(s.db, registry);
    expect(calls).toBe(1);
    expect(rowById(row.id).state).toBe('delivered');
  });

  test('an inconclusive probe leaves an interrupted row instead of a blind resend', async () => {
    let calls = 0;
    const registry = createEffectRegistry();
    registry.set('test-kind', {
      policy: 'probe',
      send: async () => {
        calls += 1;
        return {};
      },
      probe: async () => ({ verdict: 'unknown' }),
    });
    const { row } = recordEffect(s.db, intent(effectDedupeKey('k', 'probe-unknown')));
    staleSending(row.id);
    await reconcileEffects(s.db, registry);
    expect(rowById(row.id).state).toBe('interrupted');
    await drainEffects(s.db, registry);
    expect(calls).toBe(0);
  });

  test('a replay-safe stale send is requeued and delivered on the next drain', async () => {
    let calls = 0;
    const registry = createEffectRegistry();
    registry.set('test-kind', {
      policy: 'replay-safe',
      send: async () => {
        calls += 1;
        return {};
      },
    });
    const { row } = recordEffect(s.db, intent(effectDedupeKey('k', 'replay')));
    staleSending(row.id);
    const tally = await reconcileEffects(s.db, registry);
    expect(tally.requeued).toBe(1);
    await drainEffects(s.db, registry);
    expect(calls).toBe(1);
    expect(rowById(row.id).state).toBe('delivered');
  });

  test('a fresh sending row is left alone by the reconciler', async () => {
    const registry = createEffectRegistry();
    registry.set('test-kind', { policy: 'unsafe' });
    const { row } = recordEffect(s.db, intent(effectDedupeKey('k', 'fresh')));
    const claimed = claimEffect(s.db, row.id);
    expect(claimed).not.toBeNull();
    const tally = await reconcileEffects(s.db, registry);
    expect(tally.interrupted).toBe(0);
    expect(rowById(row.id).state).toBe('sending');
  });

  test('a pending row whose scope is gone is cancelled; delivered history is preserved', async () => {
    const registry = createEffectRegistry();
    registry.set('test-kind', {
      policy: 'unsafe',
      scopeGone: (_db, row) => (row.payload as { gone?: boolean }).gone === true,
    });
    const pending = recordEffect(
      s.db,
      intent(effectDedupeKey('k', 'gone'), { payload: { gone: true } }),
    );
    const delivered = recordEffect(
      s.db,
      intent(effectDedupeKey('k', 'kept'), { payload: { gone: true } }),
    );
    const claimed = claimEffect(s.db, delivered.row.id);
    s.db
      .update(externalEffect)
      .set({ state: 'delivered', receipt: {} })
      .where(eq(externalEffect.id, delivered.row.id))
      .run();
    expect(claimed).not.toBeNull();
    const tally = await reconcileEffects(s.db, registry);
    expect(tally.cancelled).toBe(1);
    expect(rowById(pending.row.id).state).toBe('cancelled');
    expect(rowById(delivered.row.id).state).toBe('delivered');
  });
});

describe('settleEffectRow and cancellation', () => {
  test('an interrupted probe row settles to delivered or requeues for a manual retry', async () => {
    const registry = createEffectRegistry();
    let verdict: 'delivered' | 'unsent' = 'unsent';
    registry.set('test-kind', {
      policy: 'probe',
      probe: async () => ({ verdict }),
    });
    const { row } = recordEffect(s.db, intent(effectDedupeKey('k', 'settle')));
    s.db
      .update(externalEffect)
      .set({ state: 'interrupted' })
      .where(eq(externalEffect.id, row.id))
      .run();
    const first = await settleEffectRow(s.db, registry, rowById(row.id));
    expect(first.state).toBe('pending');
    s.db
      .update(externalEffect)
      .set({ state: 'interrupted' })
      .where(eq(externalEffect.id, row.id))
      .run();
    verdict = 'delivered';
    const second = await settleEffectRow(s.db, registry, rowById(row.id));
    expect(second.state).toBe('delivered');
  });

  test('cancelScopeEffects cancels pending rows only', async () => {
    const a = recordEffect(s.db, intent(effectDedupeKey('k', 'scope-a')));
    const b = recordEffect(s.db, intent(effectDedupeKey('k', 'scope-b'), { scopeId: 'other' }));
    const n = cancelScopeEffects(s.db, 'todo', 'todo-1');
    expect(n).toBe(1);
    expect(rowById(a.row.id).state).toBe('cancelled');
    expect(rowById(b.row.id).state).toBe('pending');
  });
});

describe('interrupted surfacing', () => {
  const MACHINE = 'machine-fx';

  const world = (scope: { kind: 'todo' | 'step'; id: string }) => {
    s.db
      .insert(machineTable)
      .values(readyMachine({ id: MACHINE, teamId: s.team.id, name: 'fx', online: true }))
      .run();
    seedSessionRoute(s, { provider: 'stub-gw', modelId: 'stub-model', machineId: MACHINE });
    s.db.insert(projectTable).values({ id: 'proj-fx', name: 'fx', teamId: s.team.id }).run();
    s.db
      .insert(todoTable)
      .values({
        id: 'todo-fx',
        teamId: s.team.id,
        projectId: 'proj-fx',
        title: 'fx',
        phase: 'building',
        phaseAt: 1,
        latestBuildId: 'build-fx',
        seqNum: 1,
      })
      .run();
    s.db
      .insert(buildTable)
      .values({
        id: 'build-fx',
        todoId: 'todo-fx',
        withPlan: false,
        triggerSource: 'user',
        createdAt: 2,
      })
      .run();
    const stepId = scope.kind === 'step' ? scope.id : 'step-fx';
    s.db
      .insert(stepTable)
      .values({
        id: stepId,
        buildId: 'build-fx',
        kind: 'build',
        status: 'pending',
        machineId: null,
        createdAt: 3,
      })
      .run();
    const { row } = recordEffect(s.db, {
      teamId: s.team.id,
      scopeKind: scope.kind,
      scopeId: scope.id,
      kind: 'im-send',
      dedupeKey: `fx:${scope.kind}:${scope.id}`,
      payload: {},
    });
    s.db
      .update(externalEffect)
      .set({ state: 'interrupted', lastError: 'crash' })
      .where(eq(externalEffect.id, row.id))
      .run();
    const deps: MachineDeps = {
      ...s.svc,
      box: s.secretBox,
      reposDir: s.reposDir,
      attachmentsDir: s.attachmentsDir,
    };
    return deps;
  };

  test('the next claimed step on the todo carries the interrupted-effects note', async () => {
    const deps = world({ kind: 'todo', id: 'todo-fx' });
    const claim = await claimStep(deps, MACHINE, s.team.id, 10, 'http://localhost');
    expect(claim?.instruction).toContain('External effect notice');
    expect(claim?.instruction).toContain('im-send');
  });

  test('a step-scoped interrupted row also surfaces on the todo', async () => {
    const deps = world({ kind: 'step', id: 'step-fx' });
    const claim = await claimStep(deps, MACHINE, s.team.id, 10, 'http://localhost');
    expect(claim?.instruction).toContain('im-send');
  });

  test('a clean todo produces no note', async () => {
    const deps = world({ kind: 'todo', id: 'todo-fx' });
    s.db.update(externalEffect).set({ state: 'delivered' }).run();
    const claim = await claimStep(deps, MACHINE, s.team.id, 10, 'http://localhost');
    expect(claim?.instruction ?? '').not.toContain('External effect notice');
  });
});
