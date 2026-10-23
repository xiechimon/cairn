// #1491 触发闸的设置面与「人的写操作」记账：GET / PATCH
// /api/projects/{id}/autonomy、member_activity 中间件。闸本身见
// autonomy-gates.test.ts，进料接入见 issue-intake.test.ts 26 组。

import { DEFAULT_AUTONOMY_SETTINGS } from '@pacman/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { countsAsMemberWrite, lastMemberWriteAt } from '../src/services/autonomy-gates.js';
import { bootServer, req, type TestServer } from './helpers.js';

const servers: TestServer[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.dispose();
});

async function boot(): Promise<{ s: TestServer; projectId: string }> {
  const s = bootServer();
  servers.push(s);
  const res = await req(s.app, 'POST', '/api/projects', { name: 'gates' });
  expect(res.status).toBe(201);
  return { s, projectId: ((await res.json()) as { id: string }).id };
}

describe('GET / PATCH /api/projects/{id}/autonomy', () => {
  test('a new project reads the conservative defaults and an empty history', async () => {
    const { s, projectId } = await boot();
    const res = await req(s.app, 'GET', `/api/projects/${projectId}/autonomy`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      settings: DEFAULT_AUTONOMY_SETTINGS,
      spentTodayUsd: 0,
      kinds: [
        {
          kind: 'issue-intake',
          lastStartedAt: null,
          lastBlockedReason: null,
          lastEvaluatedAt: null,
        },
        { kind: 'gardener', lastStartedAt: null, lastBlockedReason: null, lastEvaluatedAt: null },
        { kind: 'auto-merge', lastStartedAt: null, lastBlockedReason: null, lastEvaluatedAt: null },
      ],
    });
  });

  test('PATCH merges the given keys; missing keys stay', async () => {
    const { s, projectId } = await boot();
    const res = await req(s.app, 'PATCH', `/api/projects/${projectId}/autonomy`, {
      enabled: false,
      dailyBudgetUsd: 2.5,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { settings: unknown };
    expect(body.settings).toEqual({
      ...DEFAULT_AUTONOMY_SETTINGS,
      enabled: false,
      dailyBudgetUsd: 2.5,
    });
    const again = await req(s.app, 'GET', `/api/projects/${projectId}/autonomy`);
    expect(((await again.json()) as { settings: unknown }).settings).toEqual(body.settings);
  });

  test.each([
    ['unknown key', { surprise: 1 }],
    ['negative minutes', { quietMinutes: -1 }],
    ['fractional minutes', { cooldownMinutes: 1.5 }],
    ['negative budget', { dailyBudgetUsd: -0.01 }],
    ['wrong type', { enabled: 'yes' }],
  ])('PATCH rejects %s with 400', async (_name, body) => {
    const { s, projectId } = await boot();
    const res = await req(s.app, 'PATCH', `/api/projects/${projectId}/autonomy`, body);
    expect(res.status).toBe(400);
  });

  test('unknown project → 404', async () => {
    const { s } = await boot();
    expect((await req(s.app, 'GET', '/api/projects/nope/autonomy')).status).toBe(404);
    expect((await req(s.app, 'PATCH', '/api/projects/nope/autonomy', {})).status).toBe(404);
  });
});

describe('member_activity: only a member’s successful writes count', () => {
  test('a successful POST is recorded; a GET and a failed write are not', async () => {
    const s = bootServer();
    servers.push(s);
    expect(lastMemberWriteAt(s.db)).toBeNull();
    await req(s.app, 'GET', '/api/projects');
    expect(lastMemberWriteAt(s.db)).toBeNull();
    // 400：body 形坏。
    expect((await req(s.app, 'POST', '/api/projects', {})).status).toBe(400);
    expect(lastMemberWriteAt(s.db)).toBeNull();
    const before = Date.now();
    expect((await req(s.app, 'POST', '/api/projects', { name: 'x' })).status).toBe(201);
    expect(lastMemberWriteAt(s.db)).toBeGreaterThanOrEqual(before);
  });

  test.each([
    ['POST', '/api/projects', 201, true],
    ['PATCH', '/api/todos/t1', 200, true],
    ['DELETE', '/api/projects/p1', 204, true],
    ['GET', '/api/projects', 200, false],
    ['HEAD', '/api/projects', 200, false],
    ['POST', '/api/projects', 409, false],
    ['POST', '/api/mcp', 200, false],
    ['POST', '/api/machine/claim', 200, false],
    ['POST', '/api/webhook/github/tok', 202, false],
    ['GET', '/api/oauth/callback', 302, false],
    ['POST', '/api/machinefoo', 200, true],
    ['POST', '/git/team/repo', 200, false],
  ] as const)('%s %s (%i) → %s', (method, path, status, counts) => {
    expect(countsAsMemberWrite(method, path, status)).toBe(counts);
  });
});
