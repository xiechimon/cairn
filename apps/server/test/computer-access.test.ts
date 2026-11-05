import { chiefIdFormat } from '@cairn/shared';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { type Db, openDbWithHandle } from '../src/db/client.js';
import {
  chief,
  chiefThread,
  computer,
  computerCall,
  machine,
  step,
  team,
  user,
} from '../src/db/schema.js';
import {
  computerCallOwnerUserId,
  ownedPrivateComputer,
  privateComputerWhere,
} from '../src/services/computer-access.js';

let db: Db;
let close: () => void;

beforeEach(() => {
  ({ db, close } = openDbWithHandle(':memory:'));
  db.insert(team)
    .values([
      { id: 'team-a', name: 'A', createdAt: 1 },
      { id: 'team-b', name: 'B', createdAt: 1 },
    ])
    .run();
  db.insert(user)
    .values([
      { id: 'alice', displayName: 'Alice' },
      { id: 'bob', displayName: 'Bob' },
    ])
    .run();
  db.insert(machine)
    .values([
      { id: 'worker', teamId: 'team-a', name: 'Worker' },
      { id: 'other-worker', teamId: 'team-a', name: 'Other' },
    ])
    .run();
  for (const userId of ['alice', 'bob']) {
    const chiefId = chiefIdFormat(userId, 'team-a');
    db.insert(chief).values({ id: chiefId, userId, teamId: 'team-a', createdAt: 1 }).run();
    db.insert(chiefThread)
      .values({
        id: `chief-thread-${userId}`,
        chiefId,
        userId,
        teamId: 'team-a',
        title: userId,
        sessionId: '',
        sessionOpenedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    db.insert(step)
      .values({
        id: `step-${userId}`,
        buildId: `chief-thread-${userId}`,
        kind: 'chief',
        createdAt: 1,
      })
      .run();
    db.insert(computer)
      .values({
        id: `computer-${userId}`,
        teamId: 'team-a',
        scopeKey: `chief:${chiefId}`,
        machineId: 'worker',
        providerRef: userId,
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
  }
});

afterEach(() => close());

function call(overrides: Partial<typeof computerCall.$inferInsert> = {}) {
  return db
    .insert(computerCall)
    .values({
      id: 'a'.repeat(64),
      teamId: 'team-a',
      stepId: 'step-alice',
      toolCallId: 'tool-a',
      machineId: 'worker',
      computerId: 'computer-alice',
      tool: 'shell',
      replaySafe: false,
      params: {},
      deadlineAt: 100,
      createdAt: 1,
      ...overrides,
    })
    .returning()
    .get();
}

describe('private computer ownership', () => {
  test('a team-only lookup exposes another owner, while the shared predicate selects only the current owner', () => {
    expect(db.select().from(computer).where(eq(computer.teamId, 'team-a')).all()).toHaveLength(2);
    expect(
      db
        .select()
        .from(computer)
        .where(privateComputerWhere('team-a', 'alice'))
        .all()
        .map((row) => row.id),
    ).toEqual(['computer-alice']);
    expect(ownedPrivateComputer(db, 'team-a', 'bob', 'computer-bob')?.id).toBe('computer-bob');
    expect(ownedPrivateComputer(db, 'team-a', 'alice', 'computer-bob')).toBeUndefined();
  });

  test.each(['wrong team', 'unknown id', 'orphan scope', 'nonprivate scope'])(
    'denies %s',
    (failure) => {
      if (failure === 'orphan scope')
        db.update(computer)
          .set({ scopeKey: 'chief:missing' })
          .where(eq(computer.id, 'computer-alice'))
          .run();
      if (failure === 'nonprivate scope')
        db.run(sql`update computer set scope = 'shared' where id = 'computer-alice'`);
      expect(
        ownedPrivateComputer(
          db,
          failure === 'wrong team' ? 'team-b' : 'team-a',
          'alice',
          failure === 'unknown id' ? 'missing' : 'computer-alice',
        ),
      ).toBeUndefined();
    },
  );
});

describe('stored computer call audience', () => {
  test.each(['alice', 'bob'])(
    'resolves the actual %s owner without an AppContext user',
    (userId) => {
      expect(
        computerCallOwnerUserId(
          db,
          call({ stepId: `step-${userId}`, computerId: `computer-${userId}` }),
        ),
      ).toBe(userId);
    },
  );

  test.each(['user_computer_shell', 'user_computer_observe', 'user_computer_act'] as const)(
    'resolves host-null %s from its stored chief thread',
    (tool) => {
      expect(
        computerCallOwnerUserId(db, call({ stepId: 'step-bob', computerId: null, tool })),
      ).toBe('bob');
    },
  );

  test.each([
    'missing step',
    'nonchief step',
    'missing thread',
    'missing chief',
    'thread owner mismatch',
    'thread team mismatch',
    'chief team mismatch',
    'noncanonical chief',
    'missing user',
    'foreign computer',
    'wrong machine',
    'deleted computer',
    'host-null orb',
    'host tool with orb',
  ])('fails closed for %s', (failure) => {
    const row = call(
      failure === 'host-null orb'
        ? { computerId: null }
        : failure === 'host tool with orb'
          ? { tool: 'user_computer_shell' }
          : {},
    );
    if (failure === 'missing step') db.delete(step).where(eq(step.id, 'step-alice')).run();
    if (failure === 'nonchief step')
      db.update(step).set({ kind: 'build' }).where(eq(step.id, 'step-alice')).run();
    if (failure === 'missing thread')
      db.delete(chiefThread).where(eq(chiefThread.id, 'chief-thread-alice')).run();
    if (failure === 'missing chief') db.delete(chief).where(eq(chief.userId, 'alice')).run();
    if (failure === 'thread owner mismatch')
      db.update(chiefThread)
        .set({ userId: 'bob' })
        .where(eq(chiefThread.id, 'chief-thread-alice'))
        .run();
    if (failure === 'thread team mismatch')
      db.update(chiefThread)
        .set({ teamId: 'team-b' })
        .where(eq(chiefThread.id, 'chief-thread-alice'))
        .run();
    if (failure === 'chief team mismatch')
      db.update(chief).set({ teamId: 'team-b' }).where(eq(chief.userId, 'alice')).run();
    if (failure === 'noncanonical chief') {
      db.update(chief).set({ id: 'alias-chief' }).where(eq(chief.userId, 'alice')).run();
      db.update(chiefThread)
        .set({ chiefId: 'alias-chief' })
        .where(eq(chiefThread.id, 'chief-thread-alice'))
        .run();
    }
    if (failure === 'missing user') db.delete(user).where(eq(user.id, 'alice')).run();
    if (failure === 'foreign computer') row.computerId = 'computer-bob';
    if (failure === 'wrong machine') row.machineId = 'other-worker';
    if (failure === 'deleted computer') {
      db.delete(computer).where(eq(computer.id, 'computer-alice')).run();
      row.computerId = null;
    }
    expect(computerCallOwnerUserId(db, row)).toBeUndefined();
  });
});
