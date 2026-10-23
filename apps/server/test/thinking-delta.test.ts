// #1308：机器上报 thinking_delta 要进会话流，且不落库。
// 失败方式：
// 1. POST {kind:'thinking_delta', text} 被 union 拒绝（400），流上没有该正文。
// 2. 空 text 不得发事件。
// 3. 晚订阅要补发当前思考段，思考段行落库后不再补发（避免和落库行叠成两份）。
// 4. text_delta 通道照旧，不把思考正文当成正文增量。
// 5. 思考增量把上一段正文封掉时，正文行不得清掉刚写入的思考快照。

import { conversationStreamEventSchema } from '@cairn/shared';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { agent as agentTable, provider as providerTable } from '../src/db/schema.js';
import { bindAllAgents, bootServer, issueApiKey, openConvStream, postProject } from './helpers.js';

const MARKER = 'REASONING-MARKER-1308';

async function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return Promise.resolve(
    app.request(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
}

async function world() {
  const s = bootServer({ pingIntervalMs: 3_600_000 });
  const apiKey = await issueApiKey(s);
  s.db
    .insert(providerTable)
    .values({
      id: 'prov-1308',
      teamId: s.team.id,
      kind: 'custom',
      providerId: 'stub-gw',
      label: 'Stub Gateway',
      baseUrl: 'http://127.0.0.1:9/v1',
      api: 'openai-completions',
      authHeader: true,
      compat: { supportsDeveloperRole: false },
      models: [{ id: 'stub-model', name: 'stub-model' }],
      createdBy: s.user.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
  s.db
    .insert(agentTable)
    .values({
      id: 'agent-1308',
      teamId: s.team.id,
      displayName: 'probe',
      provider: 'stub-gw',
      modelId: 'stub-model',
    })
    .run();
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: apiKey,
    body: { teamId: s.team.id, name: 'm-1308', cliVersion: '0.1.0' },
  });
  const { token } = (await enrollRes.json()) as { token: string };
  bindAllAgents(s);
  const projectId = await postProject(s.app);
  const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: '1308', spec: 'thinking stream' },
  });
  const { id: todoId } = (await todoRes.json()) as { id: string };
  const buildRes = await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
    body: {
      todoIds: [todoId],
      assignment: { plan: { agentId: 'agent-1308' }, build: { agentId: 'agent-1308' } },
      withPlan: false,
    },
  });
  expect(buildRes.status).toBe(201);
  const { builds } = (await buildRes.json()) as { builds: { id: string }[] };
  const buildId = builds[0]!.id;
  const claimRes = await call(s.app, 'POST', '/api/machine/tasks/claim', {
    cred: token,
    body: { running: 0 },
  });
  const claimed = (await claimRes.json()) as { step: { step: { id: string } } | null };
  expect(claimed.step).not.toBeNull();
  return { s, token, buildId, stepId: claimed.step!.step.id };
}

describe('thinking_delta on the conversation stream (#1308)', () => {
  test('forwards the text, does not persist it, and replays until the thinking row lands', async () => {
    const { s, token, buildId, stepId } = await world();
    const stream = await openConvStream(s.app, buildId);
    try {
      const res = await call(s.app, 'POST', `/api/machine/tool/${stepId}`, {
        cred: token,
        body: { kind: 'thinking_delta', text: MARKER },
      });
      expect(res.status).toBe(200);
      const ev = await stream.next((frame) => frame.type === 'thinking_delta');
      expect(conversationStreamEventSchema.parse(ev)).toEqual({
        type: 'thinking_delta',
        text: MARKER,
      });

      const empty = await call(s.app, 'POST', `/api/machine/tool/${stepId}`, {
        cred: token,
        body: { kind: 'thinking_delta', text: '' },
      });
      expect(empty.status).toBe(200);

      const textRes = await call(s.app, 'POST', `/api/machine/tool/${stepId}`, {
        cred: token,
        body: { kind: 'transcript_delta', text: 'answer' },
      });
      expect(textRes.status).toBe(200);
      const textEv = await stream.next((frame) => frame.type === 'text_delta');
      expect(textEv).toMatchObject({ type: 'text_delta', text: 'answer' });

      const messages = await call(s.app, 'GET', `/api/conversations/${buildId}/messages`);
      expect(JSON.stringify(await messages.json())).not.toContain(MARKER);
    } finally {
      await stream.close();
    }

    const late = await openConvStream(s.app, buildId);
    try {
      const replay = await late.next((frame) => frame.type === 'thinking_delta');
      expect(replay).toEqual({ type: 'thinking_delta', text: MARKER });
    } finally {
      await late.close();
    }

    const row = await call(s.app, 'POST', `/api/machine/tool/${stepId}`, {
      cred: token,
      body: {
        kind: 'transcript_row',
        row: {
          id: `msg-${stepId}-think`,
          role: 'assistant',
          content: [{ type: 'thinking', thinking: MARKER }],
          createdAt: Date.now(),
        },
      },
    });
    expect(row.status).toBe(200);

    const after = await openConvStream(s.app, buildId);
    try {
      const first = await after.next(() => true);
      expect(first.type).not.toBe('thinking_delta');
    } finally {
      after.close();
    }
    s.dispose();
  });

  test('an assistant text row does not wipe a thinking snapshot posted with the seal', async () => {
    const { s, token, buildId, stepId } = await world();
    const posted = await call(s.app, 'POST', `/api/machine/tool/${stepId}`, {
      cred: token,
      body: { kind: 'thinking_delta', text: MARKER },
    });
    expect(posted.status).toBe(200);
    const textRow = await call(s.app, 'POST', `/api/machine/tool/${stepId}`, {
      cred: token,
      body: {
        kind: 'transcript_row',
        row: {
          id: `msg-${stepId}-text`,
          role: 'assistant',
          content: [{ type: 'text', text: 'answer' }],
          createdAt: Date.now(),
        },
      },
    });
    expect(textRow.status).toBe(200);
    const late = await openConvStream(s.app, buildId);
    try {
      // 补发走串行链，排在路由首帧 ping 之前。正文行若把思考缓冲清掉，
      // 第一帧是 ping，断言立刻失败，不必干等到流超时。
      const first = await late.next(() => true);
      expect(first).toEqual({ type: 'thinking_delta', text: MARKER });
    } finally {
      await late.close();
    }
    s.dispose();
  });

  test('activity resetLive clears a thinking snapshot (retry pass)', async () => {
    const { s, token, buildId, stepId } = await world();
    const posted = await call(s.app, 'POST', `/api/machine/tool/${stepId}`, {
      cred: token,
      body: { kind: 'thinking_delta', text: MARKER },
    });
    expect(posted.status).toBe(200);
    const start = await call(s.app, 'POST', `/api/machine/tool/${stepId}`, {
      cred: token,
      body: {
        kind: 'activity',
        activity: { phase: 'starting', resetLive: true },
      },
    });
    expect(start.status).toBe(200);
    const late = await openConvStream(s.app, buildId);
    try {
      const first = await late.next(() => true);
      expect(first.type).not.toBe('thinking_delta');
    } finally {
      await late.close();
    }
    s.dispose();
  });

  test('resetLive is one-shot: catch-up after later thinking still replays it', async () => {
    const { s, token, buildId, stepId } = await world();
    await call(s.app, 'POST', `/api/machine/tool/${stepId}`, {
      cred: token,
      body: { kind: 'activity', activity: { phase: 'starting', resetLive: true } },
    });
    await call(s.app, 'POST', `/api/machine/tool/${stepId}`, {
      cred: token,
      body: { kind: 'thinking_delta', text: MARKER },
    });
    // A plain starting resend (no resetLive) must not wipe the snapshot.
    await call(s.app, 'POST', `/api/machine/tool/${stepId}`, {
      cred: token,
      body: { kind: 'activity', activity: { phase: 'starting' } },
    });
    const late = await openConvStream(s.app, buildId);
    try {
      const replay = await late.next((frame) => frame.type === 'thinking_delta');
      expect(replay).toEqual({ type: 'thinking_delta', text: MARKER });
    } finally {
      await late.close();
    }
    s.dispose();
  });
});
