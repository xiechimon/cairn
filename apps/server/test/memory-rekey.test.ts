import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  agentMemory,
  agent as agentTable,
  project as projectTable,
  routingRule,
} from '../src/db/schema.js';
import { newRecordId, nowMs } from '../src/lib/ids.js';
import { executeWorkerMemoryTool } from '../src/services/chief-tools.js';
import {
  deleteMemoryEntry,
  injectMemories,
  listMemoryEntries,
  saveMemoryEntry,
  updateMemoryEntry,
} from '../src/services/memory.js';
import { projectTurnContext } from '../src/services/project-instructions.js';
import { setRoutingRulesEnabled } from '../src/services/routing-rules.js';
import { bootServer, type TestServer } from './helpers.js';

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
    save({ agentId: 'planner', content: 'english commits', source: 'Planner' });
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
    const now = nowMs();
    s.db
      .insert(agentMemory)
      .values({
        id: newRecordId(),
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

  test('flag on: worker save_memory records the actor name when the owner is a routing rule', async () => {
    setRoutingRulesEnabled(true);
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
