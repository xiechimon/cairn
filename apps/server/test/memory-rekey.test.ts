import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { agentMemory, agent as agentTable } from '../src/db/schema.js';
import { injectMemories, listMemoryEntries, saveMemoryEntry } from '../src/services/memory.js';
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
});
