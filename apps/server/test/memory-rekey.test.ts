import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  agentMemory,
  agent as agentTable,
  project as projectTable,
  routingRule,
  todo,
} from '../src/db/schema.js';
import { newRecordId, nowMs } from '../src/lib/ids.js';
import { executeWorkerMemoryTool } from '../src/services/chief-tools.js';
import {
  deleteMemoryEntry,
  injectMemories,
  listMemoryEntries,
  promoteMemoryEntry,
  saveMemoryEntry,
  updateMemoryEntry,
} from '../src/services/memory.js';
import { projectTurnContext } from '../src/services/project-instructions.js';
import {
  adoptAgentMemories,
  memoryInjectTeamId,
  memoryOpsAreTeamScoped,
  setRoutingRulesEnabled,
} from '../src/services/routing-rules.js';
import { bootServer, req, type TestServer } from './helpers.js';

describe('memory re-key behind routing rules (#2577 PR 6)', () => {
  let s: TestServer;
  beforeEach(() => {
    s = bootServer();
    s.db
      .insert(agentTable)
      .values({
        id: 'planner',
        teamId: s.team.id,
        displayName: 'Planner',
        provider: 'stub-gw',
        modelId: 'stub-model',
      })
      .run();
    s.db
      .insert(agentTable)
      .values({
        id: 'builder',
        teamId: s.team.id,
        displayName: 'Implementer',
        provider: 'stub-gw',
        modelId: 'stub-model',
      })
      .run();
  });
  afterEach(() => {
    setRoutingRulesEnabled(false);
    s.dispose();
  });

  function save(
    over: Partial<Parameters<typeof saveMemoryEntry>[1]> & { agentId: string; content: string },
  ) {
    const row = saveMemoryEntry(s.db, {
      teamId: s.team.id,
      title: over.title ?? over.content,
      projectId: null,
      sourceTodoId: null,
      sourceBuildId: null,
      ...over,
    });
    if (!('id' in row)) throw new Error('memory not saved');
    return row;
  }

  function insertSessionRule() {
    s.db
      .insert(routingRule)
      .values({
        id: 'session-rule',
        teamId: s.team.id,
        use: 'session',
        provider: 'stub-gw',
        modelId: 'stub-model',
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
  }

  function insertReviewRule() {
    s.db
      .insert(routingRule)
      .values({
        id: 'review-rule',
        teamId: s.team.id,
        use: 'review',
        provider: 'stub-gw',
        modelId: 'stub-model',
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
  }

  function insertAdoptedCopy(original: {
    id: string;
    title: string;
    content: string;
    projectId: string | null;
    source?: string | null;
  }) {
    const now = nowMs();
    s.db
      .insert(agentMemory)
      .values({
        id: newRecordId(),
        agentId: 'session-rule',
        teamId: s.team.id,
        title: original.title,
        content: original.content,
        projectId: original.projectId,
        sourceTodoId: null,
        sourceBuildId: null,
        source: original.source ?? null,
        layer: 'core',
        adoptedFrom: original.id,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  test('flag off: a second agent does not see the first agent’s memories', () => {
    save({ agentId: 'planner', content: 'only the planner knows this' });
    expect(listMemoryEntries(s.db, { agentId: 'builder', teamId: s.team.id })).toEqual([]);
    expect(
      injectMemories(s.db, { agentId: 'builder', projectId: null }).map((m) => m.content),
    ).toEqual([]);
  });

  test('flag on: team core memories are shared and keep the saver’s name in source', () => {
    setRoutingRulesEnabled(true);
    save({
      agentId: 'planner',
      content: 'commits are English',
      source: 'Planner',
    });
    const listed = listMemoryEntries(s.db, { agentId: 'builder', teamId: s.team.id });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      content: 'commits are English',
      source: 'Planner',
      layer: 'core',
    });
    expect(
      injectMemories(s.db, {
        agentId: 'builder',
        teamId: s.team.id,
        projectId: null,
      }).map((m) => m.content),
    ).toEqual(['commits are English']);
  });

  test('flag on: a scratchpad is injected only for its thread', () => {
    setRoutingRulesEnabled(true);
    save({
      agentId: 'builder',
      content: 'try the cached index next',
      source: 'Implementer',
      layer: 'scratchpad',
      threadId: 'todo-7',
    });
    expect(
      injectMemories(s.db, {
        agentId: 'builder',
        teamId: s.team.id,
        projectId: null,
      }).map((m) => m.content),
    ).toEqual([]);
    expect(
      injectMemories(s.db, {
        agentId: 'planner',
        teamId: s.team.id,
        projectId: null,
        threadId: 'todo-8',
      }).map((m) => m.content),
    ).toEqual([]);
    expect(
      injectMemories(s.db, {
        agentId: 'planner',
        teamId: s.team.id,
        projectId: null,
        threadId: 'todo-7',
      }).map((m) => m.content),
    ).toEqual(['try the cached index next']);
  });

  test('flag on: searchable and log layers stay out of prompt injection', () => {
    setRoutingRulesEnabled(true);
    save({
      agentId: 'planner',
      content: 'search later',
      source: 'Planner',
      layer: 'searchable',
    });
    save({
      agentId: 'planner',
      content: 'dated note',
      source: 'Planner',
      layer: 'log',
    });
    expect(
      injectMemories(s.db, {
        agentId: 'planner',
        teamId: s.team.id,
        projectId: null,
      }),
    ).toEqual([]);
    expect(s.db.select().from(agentMemory).all()).toHaveLength(2);
  });

  test('flag on: an adopted routing-rule copy is not listed or injected beside the original', () => {
    setRoutingRulesEnabled(true);
    const original = save({ agentId: 'planner', content: 'english commits', source: 'Planner' });
    insertSessionRule();
    insertAdoptedCopy(original);
    const listed = listMemoryEntries(s.db, { agentId: 'builder', teamId: s.team.id });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.agentId).toBe('planner');
    expect(
      injectMemories(s.db, {
        agentId: 'builder',
        teamId: s.team.id,
        projectId: null,
      }).map((m) => m.content),
    ).toEqual(['english commits']);
  });

  test('flag on: the same content may exist per layer and per scratchpad thread', () => {
    setRoutingRulesEnabled(true);
    save({
      agentId: 'planner',
      content: 'try the index',
      layer: 'scratchpad',
      threadId: 'todo-a',
    });
    expect(
      save({
        agentId: 'planner',
        content: 'try the index',
        layer: 'scratchpad',
        threadId: 'todo-b',
      }).threadId,
    ).toBe('todo-b');
    expect(
      save({
        agentId: 'planner',
        content: 'try the index',
        layer: 'core',
      }).layer,
    ).toBe('core');
  });

  test('flag on: a project scratchpad injects in that thread through projectTurnContext', () => {
    setRoutingRulesEnabled(true);
    s.db.insert(projectTable).values({ id: 'proj-1', name: 'one', teamId: s.team.id }).run();
    save({
      agentId: 'planner',
      content: 'project scratch',
      projectId: 'proj-1',
      layer: 'scratchpad',
      threadId: 'chief-1',
    });
    expect(
      projectTurnContext(s.db, {
        teamId: s.team.id,
        agentId: 'planner',
        projectId: 'proj-1',
      }),
    ).toBeNull();
    expect(
      projectTurnContext(s.db, {
        teamId: s.team.id,
        agentId: 'planner',
        projectId: 'proj-1',
        threadId: 'chief-1',
      }),
    ).toContain('project scratch');
  });

  test('flag on: a new memory owned by a routing rule is listed, injected and updated', () => {
    setRoutingRulesEnabled(true);
    insertSessionRule();
    const row = save({
      agentId: 'session-rule',
      content: 'from the session',
      source: 'Implementer',
    });
    expect(
      listMemoryEntries(s.db, { agentId: 'builder', teamId: s.team.id }).map((m) => m.content),
    ).toEqual(['from the session']);
    expect(
      injectMemories(s.db, {
        agentId: 'builder',
        teamId: s.team.id,
        projectId: null,
      }).map((m) => m.content),
    ).toEqual(['from the session']);
    expect(
      updateMemoryEntry(s.db, {
        memoryId: row.id,
        agentId: 'builder',
        teamId: s.team.id,
        content: 'from the session, revised',
      }).content,
    ).toBe('from the session, revised');
  });

  test('flag on: an adopted copy stays hidden after the original is updated', () => {
    setRoutingRulesEnabled(true);
    const original = save({ agentId: 'planner', content: 'english commits', source: 'Planner' });
    insertSessionRule();
    insertAdoptedCopy(original);
    updateMemoryEntry(s.db, {
      memoryId: original.id,
      agentId: 'builder',
      teamId: s.team.id,
      content: 'commits stay English',
    });
    expect(
      listMemoryEntries(s.db, { agentId: 'builder', teamId: s.team.id }).map((m) => m.content),
    ).toEqual(['commits stay English']);
    expect(
      injectMemories(s.db, {
        agentId: 'builder',
        teamId: s.team.id,
        projectId: null,
      }).map((m) => m.content),
    ).toEqual(['commits stay English']);
  });

  test('flag on: deleting the original does not unmask its adopted copy', () => {
    setRoutingRulesEnabled(true);
    const original = save({ agentId: 'planner', content: 'english commits', source: 'Planner' });
    insertSessionRule();
    insertAdoptedCopy(original);
    expect(
      deleteMemoryEntry(s.db, {
        memoryId: original.id,
        agentId: 'builder',
        teamId: s.team.id,
      }),
    ).toBe(1);
    expect(listMemoryEntries(s.db, { agentId: 'builder', teamId: s.team.id })).toEqual([]);
    expect(
      injectMemories(s.db, {
        agentId: 'builder',
        teamId: s.team.id,
        projectId: null,
      }),
    ).toEqual([]);
  });

  test('flag on: promoting the original does not unmask its project-scoped adopted copy', () => {
    setRoutingRulesEnabled(true);
    s.db.insert(projectTable).values({ id: 'proj-1', name: 'one', teamId: s.team.id }).run();
    const original = save({
      agentId: 'planner',
      content: 'project fact',
      projectId: 'proj-1',
      source: 'Planner',
    });
    insertSessionRule();
    insertAdoptedCopy(original);
    expect(
      promoteMemoryEntry(s.db, {
        memoryId: original.id,
        agentId: 'builder',
        teamId: s.team.id,
      })?.projectId,
    ).toBeNull();
    const listed = listMemoryEntries(s.db, { agentId: 'builder', teamId: s.team.id });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(original.id);
    expect(listed[0]?.projectId).toBeNull();
  });

  test('flag on: a new rule-owned save is listed even when an invalid original has the same content', () => {
    setRoutingRulesEnabled(true);
    const original = save({ agentId: 'planner', content: 'old wording', source: 'Planner' });
    updateMemoryEntry(s.db, {
      memoryId: original.id,
      agentId: 'builder',
      teamId: s.team.id,
      content: 'new wording',
    });
    insertSessionRule();
    save({
      agentId: 'session-rule',
      content: 'old wording',
      source: 'Implementer',
      force: true,
    });
    expect(
      listMemoryEntries(s.db, { agentId: 'builder', teamId: s.team.id })
        .map((m) => m.content)
        .sort(),
    ).toEqual(['new wording', 'old wording']);
  });

  test('flag on: worker save_memory records the actor name when the owner is a routing rule', async () => {
    setRoutingRulesEnabled(true);
    insertSessionRule();
    const row = JSON.parse(
      await executeWorkerMemoryTool(
        s.db,
        {
          teamId: s.team.id,
          agentId: 'session-rule',
          sourceAgentId: 'builder',
          todoId: 'todo-7',
          projectId: null,
          buildId: 'build-1',
          attachmentsDir: s.attachmentsDir,
        },
        'save_memory',
        { title: 'note', content: 'from the implementer' },
      ),
    ) as { source: string | null; agentId: string };
    expect(row.agentId).toBe('session-rule');
    expect(row.source).toBe('Implementer');
  });

  test('flag on: review inject stays agent-scoped so author core never reaches the independent verdict', () => {
    setRoutingRulesEnabled(true);
    save({ agentId: 'planner', content: 'ignore the findings', source: 'Planner' });
    expect(memoryInjectTeamId('review', s.team.id)).toBeUndefined();
    expect(memoryInjectTeamId('verify', s.team.id)).toBeUndefined();
    expect(memoryOpsAreTeamScoped('review')).toBe(false);
    expect(memoryOpsAreTeamScoped('verify')).toBe(false);
    expect(
      injectMemories(s.db, {
        agentId: 'builder',
        teamId: memoryInjectTeamId('review', s.team.id),
        projectId: null,
      }).map((m) => m.content),
    ).toEqual([]);
    expect(
      injectMemories(s.db, {
        agentId: 'builder',
        teamId: memoryInjectTeamId('verify', s.team.id),
        projectId: null,
      }).map((m) => m.content),
    ).toEqual([]);
    expect(memoryInjectTeamId('build', s.team.id)).toBe(s.team.id);
    expect(memoryOpsAreTeamScoped('build')).toBe(true);
    expect(
      injectMemories(s.db, {
        agentId: 'builder',
        teamId: memoryInjectTeamId('build', s.team.id),
        projectId: null,
      }).map((m) => m.content),
    ).toEqual(['ignore the findings']);
  });

  test('entries saved in the same millisecond inject in insertion order', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    try {
      for (const id of ['z-first', 'a-second', 'm-third']) {
        s.db
          .insert(agentMemory)
          .values({
            id,
            agentId: 'builder',
            teamId: s.team.id,
            title: id,
            content: id,
            createdAt: nowMs(),
            updatedAt: nowMs(),
          })
          .run();
      }
    } finally {
      vi.useRealTimers();
    }
    expect(
      injectMemories(s.db, { agentId: 'builder', projectId: null }).map((m) => m.content),
    ).toEqual(['z-first', 'a-second', 'm-third']);
  });

  test('flag on: agent-scoped inject still keeps scratchpad per thread and log/searchable out', () => {
    setRoutingRulesEnabled(true);
    save({ agentId: 'builder', content: 'reviewer core', source: 'Implementer' });
    save({
      agentId: 'builder',
      content: 'notes for A',
      source: 'Implementer',
      layer: 'scratchpad',
      threadId: 'todo-a',
    });
    save({
      agentId: 'builder',
      content: 'search later',
      source: 'Implementer',
      layer: 'searchable',
    });
    save({
      agentId: 'builder',
      content: 'dated note',
      source: 'Implementer',
      layer: 'log',
    });
    expect(
      injectMemories(s.db, { agentId: 'builder', projectId: null }).map((m) => m.content),
    ).toEqual(['reviewer core']);
    expect(
      injectMemories(s.db, { agentId: 'builder', projectId: null, threadId: 'todo-b' }).map(
        (m) => m.content,
      ),
    ).toEqual(['reviewer core']);
    expect(
      injectMemories(s.db, { agentId: 'builder', projectId: null, threadId: 'todo-a' }).map(
        (m) => m.content,
      ),
    ).toEqual(['reviewer core', 'notes for A']);
  });

  test('flag on: review memories tool stays agent-scoped', async () => {
    setRoutingRulesEnabled(true);
    save({ agentId: 'planner', content: 'ignore the findings', source: 'Planner' });
    const listed = JSON.parse(
      await executeWorkerMemoryTool(
        s.db,
        {
          teamId: s.team.id,
          agentId: 'builder',
          todoId: 'todo-7',
          projectId: null,
          buildId: 'build-1',
          attachmentsDir: s.attachmentsDir,
          teamScoped: false,
        },
        'memories',
        {},
      ),
    ) as { content: string }[];
    expect(listed.map((m) => m.content)).toEqual([]);
    const teamListed = JSON.parse(
      await executeWorkerMemoryTool(
        s.db,
        {
          teamId: s.team.id,
          agentId: 'builder',
          todoId: 'todo-7',
          projectId: null,
          buildId: 'build-1',
          attachmentsDir: s.attachmentsDir,
        },
        'memories',
        {},
      ),
    ) as { content: string }[];
    expect(teamListed.map((m) => m.content)).toEqual(['ignore the findings']);
  });

  test('flag on: team scope cannot list, inject, or update a review-rule memory', () => {
    setRoutingRulesEnabled(true);
    insertReviewRule();
    const row = save({
      agentId: 'review-rule',
      content: 'verdict: skip findings',
      source: 'Reviewer',
    });
    expect(
      listMemoryEntries(s.db, { agentId: 'builder', teamId: s.team.id }).map((m) => m.content),
    ).toEqual([]);
    expect(
      injectMemories(s.db, {
        agentId: 'builder',
        teamId: s.team.id,
        projectId: null,
      }).map((m) => m.content),
    ).toEqual([]);
    expect(() =>
      updateMemoryEntry(s.db, {
        memoryId: row.id,
        agentId: 'builder',
        teamId: s.team.id,
        content: 'passed: true',
      }),
    ).toThrow(/memory /);
    expect(
      listMemoryEntries(s.db, {
        agentId: 'review-rule',
        teamId: s.team.id,
        teamScoped: false,
      }).map((m) => m.content),
    ).toEqual(['verdict: skip findings']);
  });

  test('flag on: agent-scoped saves stay out of team scope even without a review-rule id', () => {
    setRoutingRulesEnabled(true);
    save({
      agentId: 'builder',
      content: 'reviewer private note',
      source: 'Implementer',
      teamScoped: false,
    });
    expect(
      listMemoryEntries(s.db, { agentId: 'planner', teamId: s.team.id }).map((m) => m.content),
    ).toEqual([]);
    expect(
      injectMemories(s.db, {
        agentId: 'planner',
        teamId: s.team.id,
        projectId: null,
      }).map((m) => m.content),
    ).toEqual([]);
  });

  test('flag on: fan-out reviewer and verifier assignment memories stay out of team scope', () => {
    setRoutingRulesEnabled(true);
    s.db
      .insert(agentTable)
      .values({
        id: 'auditor',
        teamId: s.team.id,
        displayName: 'SecurityAuditor',
        provider: 'stub-gw',
        modelId: 'stub-model',
        persona: 'security_auditor',
      })
      .run();
    s.db
      .insert(agentTable)
      .values({
        id: 'slot-verifier',
        teamId: s.team.id,
        displayName: 'SlotVerifier',
        provider: 'stub-gw',
        modelId: 'stub-model',
      })
      .run();
    save({ agentId: 'auditor', content: 'security lens', source: 'SecurityAuditor' });
    save({
      agentId: 'slot-verifier',
      content: 'verify lens',
      source: 'SlotVerifier',
      teamScoped: false,
    });
    expect(
      listMemoryEntries(s.db, { agentId: 'builder', teamId: s.team.id }).map((m) => m.content),
    ).toEqual([]);
    expect(
      injectMemories(s.db, {
        agentId: 'builder',
        teamId: s.team.id,
        projectId: null,
      }).map((m) => m.content),
    ).toEqual([]);
  });

  test('flag on: author core stays team-visible when the same agent later verifies', () => {
    setRoutingRulesEnabled(true);
    s.db.insert(projectTable).values({ id: 'proj-dual', name: 'one', teamId: s.team.id }).run();
    s.db
      .insert(todo)
      .values({
        id: 'todo-dual',
        teamId: s.team.id,
        projectId: 'proj-dual',
        title: 'ship',
        spec: '',
        phase: 'todo',
        phaseAt: 1,
        seqNum: 1,
        assignment: {
          plan: null,
          build: { agentId: 'builder' },
          verify: { agentId: 'builder' },
        },
      })
      .run();
    save({ agentId: 'builder', content: 'build habit', source: 'Implementer' });
    save({
      agentId: 'builder',
      content: 'verify lens',
      source: 'Implementer',
      teamScoped: false,
    });
    expect(
      listMemoryEntries(s.db, { agentId: 'planner', teamId: s.team.id }).map((m) => m.content),
    ).toEqual(['build habit']);
    expect(
      injectMemories(s.db, {
        agentId: 'planner',
        teamId: s.team.id,
        projectId: null,
      }).map((m) => m.content),
    ).toEqual(['build habit']);
  });

  test('flag on: agent memory API lists the requested reviewer store', async () => {
    setRoutingRulesEnabled(true);
    insertReviewRule();
    save({
      agentId: 'review-rule',
      content: 'reviewer private note',
      source: 'Reviewer',
      teamScoped: false,
    });
    save({ agentId: 'planner', content: 'author core', source: 'Planner' });
    const res = await req(s.app, 'GET', `/api/teams/${s.team.id}/agents/review-rule/memories`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { content: string }[]).map((m) => m.content)).toEqual([
      'reviewer private note',
    ]);
  });

  test('flag on: reviewer update duplicate check stays agent-scoped', () => {
    setRoutingRulesEnabled(true);
    save({ agentId: 'planner', content: 'author note', source: 'Planner' });
    const own = save({
      agentId: 'builder',
      content: 'reviewer note',
      source: 'Implementer',
      teamScoped: false,
    });
    expect(
      updateMemoryEntry(s.db, {
        memoryId: own.id,
        agentId: 'builder',
        teamId: s.team.id,
        content: 'author note',
        teamScoped: false,
      }).content,
    ).toBe('author note');
  });

  test('flag on: an edited adopted copy is marked through its successor chain', () => {
    setRoutingRulesEnabled(true);
    const original = save({ agentId: 'planner', content: 'english commits', source: 'Planner' });
    insertSessionRule();
    const copyId = createHash('sha256')
      .update(JSON.stringify(['adopt', 'session-rule', original.id]))
      .digest('hex');
    const now = nowMs();
    s.db
      .insert(agentMemory)
      .values({
        id: copyId,
        agentId: 'session-rule',
        teamId: s.team.id,
        title: 'english commits',
        content: 'english commits',
        projectId: null,
        sourceTodoId: null,
        sourceBuildId: null,
        source: 'Planner',
        layer: 'core',
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const successorId = newRecordId();
    s.db
      .insert(agentMemory)
      .values({
        id: successorId,
        agentId: 'session-rule',
        teamId: s.team.id,
        title: 'english commits',
        content: 'commits stay English',
        projectId: null,
        sourceTodoId: null,
        sourceBuildId: null,
        source: 'Planner',
        layer: 'core',
        createdAt: now + 1,
        updatedAt: now + 1,
      })
      .run();
    s.db
      .update(agentMemory)
      .set({ invalidAt: now + 1, supersededBy: successorId })
      .where(eq(agentMemory.id, copyId))
      .run();
    adoptAgentMemories(s.db);
    expect(
      listMemoryEntries(s.db, { agentId: 'builder', teamId: s.team.id }).map((m) => m.content),
    ).toEqual(['english commits']);
  });

  test('entries written in the same millisecond keep insertion order', () => {
    const at = nowMs();
    s.db
      .insert(agentMemory)
      .values({
        id: 'zzz-first',
        agentId: 'ordering-probe',
        teamId: s.team.id,
        title: 'first',
        content: 'first',
        projectId: null,
        sourceTodoId: null,
        sourceBuildId: null,
        source: 'Planner',
        layer: 'core',
        createdAt: at,
        updatedAt: at,
      })
      .run();
    s.db
      .insert(agentMemory)
      .values({
        id: 'aaa-second',
        agentId: 'ordering-probe',
        teamId: s.team.id,
        title: 'second',
        content: 'second',
        projectId: null,
        sourceTodoId: null,
        sourceBuildId: null,
        source: 'Planner',
        layer: 'core',
        createdAt: at,
        updatedAt: at,
      })
      .run();
    expect(
      listMemoryEntries(s.db, { agentId: 'ordering-probe', teamId: s.team.id }).map(
        (m) => m.content,
      ),
    ).toEqual(['first', 'second']);
  });

  test('flag on: a scratchpad is listed and mutated only in its thread', () => {
    setRoutingRulesEnabled(true);
    const pad = save({
      agentId: 'planner',
      content: 'private to todo-7',
      layer: 'scratchpad',
      threadId: 'todo-7',
    });
    const core = save({
      agentId: 'planner',
      content: 'shared fact',
      layer: 'core',
    });
    expect(
      listMemoryEntries(s.db, { agentId: 'builder', teamId: s.team.id }).map((m) => m.content),
    ).toEqual(['shared fact']);
    expect(
      listMemoryEntries(s.db, {
        agentId: 'builder',
        teamId: s.team.id,
        threadId: 'todo-7',
      }).map((m) => m.content),
    ).toEqual(['private to todo-7', 'shared fact']);
    expect(
      deleteMemoryEntry(s.db, {
        memoryId: pad.id,
        agentId: 'builder',
        teamId: s.team.id,
        threadId: 'todo-8',
      }),
    ).toBe(0);
    expect(() =>
      updateMemoryEntry(s.db, {
        memoryId: pad.id,
        agentId: 'builder',
        teamId: s.team.id,
        threadId: 'todo-8',
        content: 'hijacked',
      }),
    ).toThrow(/memory /);
    expect(
      updateMemoryEntry(s.db, {
        memoryId: core.id,
        agentId: 'builder',
        teamId: s.team.id,
        content: 'shared fact updated',
      }).content,
    ).toBe('shared fact updated');
    expect(
      deleteMemoryEntry(s.db, {
        memoryId: pad.id,
        agentId: 'builder',
        teamId: s.team.id,
        threadId: 'todo-7',
      }),
    ).toBe(1);
  });
});
