import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { agentMemory, project as projectTable, routingRule } from '../src/db/schema.js';
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
import { memoryOpsAreTeamScoped, memoryOwnerOf } from '../src/services/routing-rules.js';
import { bootServer, type TestServer } from './helpers.js';

describe('memory re-key behind routing rules (#2577 PR 6)', () => {
  let s: TestServer;
  beforeEach(() => {
    s = bootServer();
  });
  afterEach(() => {
    s.dispose();
  });

  function injectedContent(scope: Parameters<typeof injectMemories>[1]) {
    return injectMemories(s.db, scope)
      .filter((m) => m.content !== '')
      .map((m) => m.content);
  }

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

  function _insertReviewRule() {
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

  test('team core memories are shared and keep the saver’s name in source', () => {
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
      injectedContent({
        agentId: 'builder',
        teamId: s.team.id,
        projectId: null,
      }),
    ).toEqual(['- commits are English：commits are English']);
  });

  test('a scratchpad is injected only for its thread', () => {
    save({
      agentId: 'builder',
      content: 'try the cached index next',
      source: 'Implementer',
      layer: 'scratchpad',
      threadId: 'todo-7',
    });
    expect(
      injectedContent({
        agentId: 'builder',
        teamId: s.team.id,
        projectId: null,
      }),
    ).toEqual([]);
    expect(
      injectedContent({
        agentId: 'planner',
        teamId: s.team.id,
        projectId: null,
        threadId: 'todo-8',
      }),
    ).toEqual([]);
    expect(
      injectedContent({
        agentId: 'planner',
        teamId: s.team.id,
        projectId: null,
        threadId: 'todo-7',
      }),
    ).toEqual(['try the cached index next']);
  });

  test('the searchable layer stays out of prompt injection', () => {
    save({
      agentId: 'planner',
      content: 'search later',
      source: 'Planner',
      layer: 'searchable',
    });
    expect(
      injectedContent({
        agentId: 'planner',
        teamId: s.team.id,
        projectId: null,
      }),
    ).toEqual([]);
    expect(
      s.db
        .select()
        .from(agentMemory)
        .all()
        .filter((m) => m.layer === 'searchable'),
    ).toHaveLength(1);
  });

  test('an adopted routing-rule copy is not listed or injected beside the original', () => {
    const original = save({ agentId: 'planner', content: 'english commits', source: 'Planner' });
    insertSessionRule();
    insertAdoptedCopy(original);
    const listed = listMemoryEntries(s.db, { agentId: 'builder', teamId: s.team.id });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.agentId).toBe('planner');
    expect(
      injectedContent({
        agentId: 'builder',
        teamId: s.team.id,
        projectId: null,
      }),
    ).toEqual(['- english commits：english commits']);
  });

  test('the same content may exist per layer and per scratchpad thread', () => {
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

  test('a project scratchpad injects in that thread through projectTurnContext', () => {
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
    ).not.toContain('project scratch');
    expect(
      projectTurnContext(s.db, {
        teamId: s.team.id,
        agentId: 'planner',
        projectId: 'proj-1',
        threadId: 'chief-1',
      }),
    ).toContain('project scratch');
  });

  test('a new memory owned by a routing rule is listed, injected and updated', () => {
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
      injectedContent({
        agentId: 'builder',
        teamId: s.team.id,
        projectId: null,
      }),
    ).toEqual(['- from the session：from the session']);
    expect(
      updateMemoryEntry(s.db, {
        memoryId: row.id,
        agentId: 'builder',
        teamId: s.team.id,
        content: 'from the session, revised',
      }).content,
    ).toBe('from the session, revised');
  });

  test('an adopted copy stays hidden after the original is updated', () => {
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
      injectedContent({
        agentId: 'builder',
        teamId: s.team.id,
        projectId: null,
      }),
    ).toEqual(['- english commits：commits stay English']);
  });

  test('deleting the original does not unmask its adopted copy', () => {
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
      injectedContent({
        agentId: 'builder',
        teamId: s.team.id,
        projectId: null,
      }),
    ).toEqual([]);
  });

  test('promoting the original does not unmask its project-scoped adopted copy', () => {
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

  test('a new rule-owned save is listed even when an invalid original has the same content', () => {
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
    });
    expect(
      listMemoryEntries(s.db, { agentId: 'builder', teamId: s.team.id })
        .map((m) => m.content)
        .sort(),
    ).toEqual(['new wording', 'old wording']);
  });

  test('worker save_memory records the actor name when the owner is a routing rule', async () => {
    insertSessionRule();
    const row = JSON.parse(
      await executeWorkerMemoryTool(
        s.db,
        {
          teamId: s.team.id,
          agentId: 'session-rule',
          sourceName: 'Implementer',
          todoId: 'todo-7',
          projectId: null,
          buildId: 'build-1',
          attachmentsDir: s.attachmentsDir,
        },
        'save_memory',
        { scope: 'team', file: 'note', content: 'from the implementer' },
      ),
    ) as { source: string | null; agentId: string };
    expect(row.agentId).toBe('session-rule');
    expect(row.source).toBe('Implementer');
  });

  test('review inject stays agent-scoped so author core never reaches the independent verdict', () => {
    save({ agentId: 'planner', content: 'ignore the findings', source: 'Planner' });
    expect(memoryOpsAreTeamScoped('review')).toBe(false);
    expect(memoryOpsAreTeamScoped('verify')).toBe(false);
    expect(
      injectedContent({
        agentId: 'builder',
        teamId: s.team.id,
        teamScoped: false,
        projectId: null,
      }),
    ).toEqual([]);
    expect(
      injectedContent({
        agentId: 'builder',
        teamId: s.team.id,
        teamScoped: false,
        projectId: null,
      }),
    ).toEqual([]);
    expect(memoryOpsAreTeamScoped('build')).toBe(true);
    expect(
      injectedContent({
        agentId: 'builder',
        teamId: s.team.id,
        projectId: null,
      }),
    ).toEqual(['- ignore the findings：ignore the findings']);
  });

  test('the verifier has its own memory owner: implementer memories are invisible and immutable to it', () => {
    insertSessionRule();
    const implementer = memoryOwnerOf(s.db, s.team.id, 'build');
    const verifier = memoryOwnerOf(s.db, s.team.id, 'verify');
    expect(implementer).toBe('session-rule');
    expect(verifier).not.toBe(implementer);
    const mine = save({ agentId: implementer, content: 'implementer secret sauce' });
    const scope = { agentId: verifier, teamId: s.team.id, teamScoped: false };
    save({ agentId: verifier, content: 'verifier lens', teamScoped: false });
    expect(listMemoryEntries(s.db, scope).map((m) => m.content)).toEqual(['verifier lens']);
    expect(
      injectedContent({
        agentId: verifier,
        teamId: s.team.id,
        teamScoped: false,
        projectId: null,
      }),
    ).toEqual(['- verifier lens：verifier lens']);
    expect(() =>
      updateMemoryEntry(s.db, { ...scope, memoryId: mine.id, content: 'tampered' }),
    ).toThrow(/memory/);
    expect(deleteMemoryEntry(s.db, { ...scope, memoryId: mine.id })).toBe(0);
    expect(
      listMemoryEntries(s.db, { agentId: implementer, teamId: s.team.id }).map((m) => m.content),
    ).toEqual(['implementer secret sauce']);
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
    expect(injectedContent({ teamId: s.team.id, agentId: 'builder', projectId: null })).toEqual([
      '- z-first：z-first\n- a-second：a-second\n- m-third：m-third',
    ]);
  });

  test('agent-scoped inject still keeps scratchpad per thread and log/searchable out', () => {
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
    expect(injectedContent({ teamId: s.team.id, agentId: 'builder', projectId: null })).toEqual([
      '- reviewer core：reviewer core',
    ]);
    expect(
      injectedContent({
        teamId: s.team.id,
        agentId: 'builder',
        projectId: null,
        threadId: 'todo-b',
      }),
    ).toEqual(['- reviewer core：reviewer core']);
    expect(
      injectedContent({
        teamId: s.team.id,
        agentId: 'builder',
        projectId: null,
        threadId: 'todo-a',
      }),
    ).toEqual(['- reviewer core：reviewer core', 'notes for A']);
  });

  test('review memories tool stays agent-scoped', async () => {
    save({ agentId: 'planner', content: 'ignore the findings', source: 'Planner' });
    const listed = JSON.parse(
      await executeWorkerMemoryTool(
        s.db,
        {
          teamId: s.team.id,
          agentId: 'builder',
          sourceName: null,
          todoId: 'todo-7',
          projectId: null,
          buildId: 'build-1',
          attachmentsDir: s.attachmentsDir,
          teamScoped: false,
        },
        'memories',
        {},
      ),
    ) as { documents: { firstLine: string }[] };
    expect(listed.documents.map((m) => m.firstLine)).toEqual(['']);
    const teamListed = JSON.parse(
      await executeWorkerMemoryTool(
        s.db,
        {
          teamId: s.team.id,
          agentId: 'builder',
          sourceName: null,
          todoId: 'todo-7',
          projectId: null,
          buildId: 'build-1',
          attachmentsDir: s.attachmentsDir,
        },
        'memories',
        {},
      ),
    ) as { documents: { firstLine: string }[] };
    expect(teamListed.documents.map((m) => m.firstLine)).toEqual([
      '- ignore the findings：ignore the findings',
    ]);
  });

  test('agent-scoped saves stay out of team scope even without a review-rule id', () => {
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
      injectedContent({
        agentId: 'planner',
        teamId: s.team.id,
        projectId: null,
      }),
    ).toEqual([]);
  });

  test('author core stays team-visible when the same agent later verifies', () => {
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
      injectedContent({
        agentId: 'planner',
        teamId: s.team.id,
        projectId: null,
      }),
    ).toEqual(['- build habit：build habit']);
  });

  test('reviewer update duplicate check stays agent-scoped', () => {
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

  test('a scratchpad is listed and mutated only in its thread', () => {
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
