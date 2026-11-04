import { searchResponseSchema } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { agent } from '../src/db/schema.js';
import { newRecordId } from '../src/lib/ids.js';
import { bootServer, postProject, req, type TestServer } from './helpers.js';

async function withCorpus() {
  const s = bootServer();
  const projectId = await postProject(s.app, '官网重构');
  await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title: '写贡献指南', spec: '' });
  await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: 'README 加 100%_覆盖 说明',
    spec: '',
  });
  const other = await postProject(s.app, 'data-pipeline');
  await req(s.app, 'POST', `/api/projects/${other}/todos`, { title: 'fix bug', spec: '' });
  s.db
    .insert(agent)
    .values({
      id: newRecordId(),
      teamId: s.team.id,
      displayName: '小指南',
      status: 'active',
      tools: [],
      secrets: [],
      defaultSkill: null,
      skillsAllowlist: null,
      mcpServers: [],
    })
    .run();
  return { ...s, projectId, other };
}

async function runSearch(s: TestServer, q: string | null) {
  const path = q === null ? '/api/search' : `/api/search?q=${encodeURIComponent(q)}`;
  const res = await req(s.app, 'GET', path);
  expect(res.status).toBe(200);
  return searchResponseSchema.parse(await res.json());
}

describe('GET /api/search (02 §6.3)', () => {
  test('three-set hits: todo.title / project.name / agent.displayName LIKE', async () => {
    const s = await withCorpus();
    const hit = await runSearch(s, '指南');
    expect(hit.todos.map((t) => t.title)).toEqual(['写贡献指南']);
    expect(hit.todos[0]).toMatchObject({
      seqNum: 1,
      phase: 'todo',
      projectName: '官网重构',
      phaseAt: expect.any(Number),
    });
    expect(hit.agents.map((a) => a.displayName)).toEqual(['小指南']);
    expect(hit.projects).toEqual([]);

    const byProject = await runSearch(s, '官网');
    expect(byProject.projects).toEqual([{ id: s.projectId, name: '官网重构' }]);
    expect(byProject.todos).toEqual([]);
  });

  test('case-insensitive (SQLite LIKE built-in, ASCII); substrings hit', async () => {
    const s = await withCorpus();
    const hit = await runSearch(s, 'FIX');
    expect(hit.todos.map((t) => t.title)).toEqual(['fix bug']);
    const sub = await runSearch(s, 'EADME');
    expect(sub.todos).toHaveLength(1);
  });

  test('LIKE wildcards escaped literally: % and _ are not wildcards [design]', async () => {
    const s = await withCorpus();
    const pct = await runSearch(s, '%');
    expect(pct.todos.map((t) => t.title)).toEqual(['README 加 100%_覆盖 说明']);
    const us = await runSearch(s, '_');
    expect(us.todos.map((t) => t.title)).toEqual(['README 加 100%_覆盖 说明']);
    const literal = await runSearch(s, '100%_覆盖');
    expect(literal.todos).toHaveLength(1);
  });

  test('no results -> three empty arrays (the no-results copy = client canon, shared searchNoResultsCopy)', async () => {
    const s = await withCorpus();
    const miss = await runSearch(s, '不存在');
    expect(miss).toEqual({ todos: [], projects: [], agents: [] });
  });

  test('empty q / missing q -> three empty arrays [design] (the empty-input go group = client behavior, r2 04)', async () => {
    const s = await withCorpus();
    expect(await runSearch(s, '')).toEqual({ todos: [], projects: [], agents: [] });
    expect(await runSearch(s, null)).toEqual({ todos: [], projects: [], agents: [] });
  });

  test('todos in a stable seqNum order (the panel grouping order [design])', async () => {
    const s = await withCorpus();
    const hit = await runSearch(s, '写');
    expect(hit.todos.map((t) => t.seqNum)).toEqual([...hit.todos.map((t) => t.seqNum)].sort());
  });
});
