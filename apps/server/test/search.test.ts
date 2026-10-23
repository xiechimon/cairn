// ⌘K 搜索对拍（02 §6.3 [设计] 自设 + 02 §11「无外部真值；面板行为对 r2 04
// 即可」口径，04 附录 A：不触发补采、无平价义务）。
// wire 契约单源 = shared searchResponseSchema；三集 = todo.title /
// project.name / agent.displayName（placeholder「搜索任务、项目、成员…」三组，
// r2 04 面板形——空输入「前往」组与无结果态文案 = 客户端面，shared canon）。

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
  return searchResponseSchema.parse(await res.json()); // 形状即契约（02/A9）
}

describe('GET /api/search（02 §6.3）', () => {
  test('三集命中：todo.title / project.name / agent.displayName LIKE', async () => {
    const s = await withCorpus();
    const hit = await runSearch(s, '指南');
    expect(hit.todos.map((t) => t.title)).toEqual(['写贡献指南']);
    // W4 #286：todo 行带 phaseAt（面板行右缘相对时间位）。
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

  test('大小写不敏感（SQLite LIKE 内建，ASCII）；子串即中', async () => {
    const s = await withCorpus();
    const hit = await runSearch(s, 'FIX');
    expect(hit.todos.map((t) => t.title)).toEqual(['fix bug']);
    const sub = await runSearch(s, 'EADME');
    expect(sub.todos).toHaveLength(1);
  });

  test('LIKE 通配按字面转义：% _ 不作通配 [设计]', async () => {
    const s = await withCorpus();
    // `100%_覆盖` 标题：查 `%` 只命中含字面 % 的行，而非全表。
    const pct = await runSearch(s, '%');
    expect(pct.todos.map((t) => t.title)).toEqual(['README 加 100%_覆盖 说明']);
    const us = await runSearch(s, '_');
    expect(us.todos.map((t) => t.title)).toEqual(['README 加 100%_覆盖 说明']);
    const literal = await runSearch(s, '100%_覆盖');
    expect(literal.todos).toHaveLength(1);
  });

  test('无结果 → 三空数组（无结果态文案 = 客户端 canon，shared searchNoResultsCopy）', async () => {
    const s = await withCorpus();
    const miss = await runSearch(s, '不存在');
    expect(miss).toEqual({ todos: [], projects: [], agents: [] });
  });

  test('空 q / 缺 q → 三空数组 [设计]（空输入「前往」组 = 客户端行为，r2 04）', async () => {
    const s = await withCorpus();
    expect(await runSearch(s, '')).toEqual({ todos: [], projects: [], agents: [] });
    expect(await runSearch(s, null)).toEqual({ todos: [], projects: [], agents: [] });
  });

  test('todos 按 seqNum 稳定序（面板分组序 [设计]）', async () => {
    const s = await withCorpus();
    const hit = await runSearch(s, '写');
    expect(hit.todos.map((t) => t.seqNum)).toEqual([...hit.todos.map((t) => t.seqNum)].sort());
  });
});
