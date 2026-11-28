import type { WorkspaceFileReadEvent } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { build, chiefMessage, chiefThread, machine, step, team, todo } from '../src/db/schema.js';
import { hashCredential } from '../src/lib/hash.js';
import { bootServer, postProject, req } from './helpers.js';

const source = { conversation: 'report-build', step: 'report-step', message: 'report-message' };
const route = `/api/conversations/${source.conversation}/messages/${source.message}/file`;
const reportMessage =
  'The results are in `report.md`. See [quarterly report](quarter\\_report.md).';

async function world() {
  const s = bootServer();
  const projectId = await postProject(s.app);
  const response = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: 'Write an adoption report',
    spec: '',
  });
  const task = (await response.json()) as { id: string };
  s.db
    .insert(machine)
    .values({
      id: 'report-runner',
      teamId: s.team.id,
      name: 'Report runner',
      tokenHash: hashCredential('report-runner-test-token'),
      capabilities: { mcpServers: [], skills: [], workspaceFileRead: true },
    })
    .run();
  s.db
    .insert(build)
    .values({
      id: source.conversation,
      todoId: task.id,
      withPlan: false,
      triggerSource: 'user',
      createdAt: 1,
    })
    .run();
  s.db
    .insert(step)
    .values({
      id: source.step,
      buildId: source.conversation,
      kind: 'build',
      status: 'claimed',
      machineId: 'report-runner',
      claimedAt: 1,
      createdAt: 1,
    })
    .run();
  const runner = (url: string, body: unknown, token = 'report-runner-test-token') =>
    s.app.request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  const stamp = 'opaque_workspace_instance_for_the_report_step';
  const publish = (workspace?: string, text = reportMessage) =>
    runner(`/api/machine/tool/${source.step}?generation=1`, {
      kind: 'transcript_row',
      row: {
        id: source.message,
        role: 'assistant',
        createdAt: 2,
        content: [{ type: 'text', text }],
      },
      ...(workspace === undefined ? {} : { workspace }),
    });
  const open = (path = 'report.md') => req(s.app, 'POST', route, { path });
  const events: WorkspaceFileReadEvent[] = [];
  const attach = () =>
    s.machineHub.subscribeMachine(s.team.id, 'report-runner', (event) => {
      if (event.type === 'workspace.file.read') events.push(event);
    });
  const next = async (count: number) => {
    await expect.poll(() => events.length).toBe(count);
    return events[count - 1]!;
  };
  const reply = (
    event: WorkspaceFileReadEvent,
    result: unknown,
    connectionId = s.machineHub.connectionId('report-runner'),
    token?: string,
  ) => runner(`/api/machine/workspace-file/${event.requestId}`, { connectionId, result }, token);
  return { s, stamp, publish, open, attach, next, reply, task, events };
}

test('a producing runner offline is reported rather than opening a different workspace', async () => {
  const { s, stamp, publish, open } = await world();
  try {
    expect((await publish(stamp)).status).toBe(200);
    const response = await open();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'offline' });
  } finally {
    s.dispose();
  }
});

test('the authenticated producer alone can supply current bytes and gone results', async () => {
  const { s, stamp, publish, open, attach, next, reply, task } = await world();
  const closeProducer = attach();
  const otherEvents: string[] = [];
  s.db
    .insert(machine)
    .values({
      id: 'other-runner',
      teamId: s.team.id,
      name: 'Other runner',
      tokenHash: hashCredential('other-runner-test-token'),
      capabilities: { mcpServers: [], skills: [], workspaceFileRead: true },
    })
    .run();
  const closeOther = s.machineHub.subscribeMachine(s.team.id, 'other-runner', (event) =>
    otherEvents.push(event.type),
  );
  try {
    expect((await publish(stamp)).status).toBe(200);
    const history = await s.app.request(`/api/conversations/${source.conversation}/messages`);
    const body = await history.text();
    expect(JSON.parse(body)).toMatchObject({
      messages: [
        { workspaceFileLinks: true, workspaceFilePaths: ['report.md', 'quarter_report.md'] },
      ],
    });
    expect(body).not.toContain(stamp);
    expect((await open('not-mentioned.md')).status).toBe(404);
    expect((await open('../report.md')).status).toBe(400);
    expect((await req(s.app, 'POST', route, { path: 'report.md', workspace: stamp })).status).toBe(
      400,
    );

    const opening = open();
    const event = await next(1);
    expect(event).toEqual({
      type: 'workspace.file.read',
      requestId: expect.any(String),
      path: 'report.md',
      workspace: stamp,
    });
    expect(otherEvents).not.toContain('workspace.file.read');
    const text = { status: 'ok', text: 'Adoption report' };
    const connectionId = s.machineHub.connectionId('report-runner');
    expect((await reply(event, text, connectionId, 'other-runner-test-token')).status).toBe(404);
    expect((await reply(event, text, 'not-the-stream')).status).toBe(404);
    expect((await reply(event, text)).status).toBe(200);
    expect((await opening).headers.get('cache-control')).toBe('no-store');
    expect(await (await opening).json()).toEqual(text);
    expect((await reply(event, text)).status).toBe(404);

    const reopening = open();
    expect((await reply(await next(2), { status: 'ok', text: 'Updated report' })).status).toBe(200);
    expect(await (await reopening).json()).toEqual({ status: 'ok', text: 'Updated report' });
    const gone = open('quarter_report.md');
    const escapedLink = await next(3);
    expect(escapedLink.path).toBe('quarter_report.md');
    expect((await reply(escapedLink, { status: 'gone' })).status).toBe(200);
    expect(await (await gone).json()).toEqual({ status: 'gone' });
    s.db.insert(team).values({ id: 'foreign-team', name: 'Foreign team', createdAt: 1 }).run();
    s.db.update(todo).set({ teamId: 'foreign-team' }).where(eq(todo.id, task.id)).run();
    expect((await open()).status).toBe(404);
  } finally {
    closeProducer();
    closeOther();
    s.dispose();
  }
});

test('a replacement stream retires the pending read and old runners do not get requests', async () => {
  const { s, stamp, publish, open, attach, next, reply, events } = await world();
  const close = attach();
  try {
    expect((await publish(stamp)).status).toBe(200);
    const opening = open();
    const event = await next(1);
    const oldConnection = s.machineHub.connectionId('report-runner');
    const closeReplacement = attach();
    try {
      expect(await (await opening).json()).toEqual({ status: 'offline' });
      expect((await reply(event, { status: 'ok', text: 'late' }, oldConnection)).status).toBe(404);
      s.db
        .update(machine)
        .set({ capabilities: { mcpServers: [], skills: [] } })
        .where(eq(machine.id, 'report-runner'))
        .run();
      expect(await (await open()).json()).toEqual({ status: 'unavailable' });
      expect(events).toHaveLength(1);
    } finally {
      closeReplacement();
    }
  } finally {
    close();
    s.dispose();
  }
});

test('an old transcript remains intact without granting workspace authority', async () => {
  const { s, publish, open } = await world();
  try {
    expect((await publish()).status).toBe(200);
    const response = await open();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ status: 'unavailable' });
    const history = await s.app.request(`/api/conversations/${source.conversation}/messages`);
    expect(await history.json()).toMatchObject({
      messages: [
        {
          id: source.message,
          content: [{ type: 'text', text: reportMessage }],
        },
      ],
    });
  } finally {
    s.dispose();
  }
});

test('only rendered Markdown references authorize workspace files', async () => {
  const { s, stamp, publish, open } = await world();
  try {
    await publish(
      stamp,
      '```text\n[hidden](secret-report.md)\n```\n\n[web](https://example.com/private-report.md)\n\n[actual](<docs/annual.md>)',
    );
    const history = await s.app.request(`/api/conversations/${source.conversation}/messages`);
    expect(await history.json()).toMatchObject({
      messages: [{ workspaceFilePaths: ['docs/annual.md'] }],
    });
    expect((await open('secret-report.md')).status).toBe(404);
    expect((await open('private-report.md')).status).toBe(404);
    expect((await open('docs/annual.md')).status).toBe(503);
  } finally {
    s.dispose();
  }
});

test('Coordinator history and file requests use the same Markdown authority', async () => {
  const { s, stamp } = await world();
  try {
    const id = 'chief-file-test';
    s.db
      .insert(chiefThread)
      .values({
        id,
        chiefId: 'chief-file-test-owner',
        userId: s.user.id,
        teamId: s.team.id,
        title: 'Files',
        createdAt: 1,
        updatedAt: 1,
        sessionId: '',
        sessionOpenedAt: 1,
      })
      .run();
    s.db
      .insert(chiefMessage)
      .values({
        id: 'chief-file-message',
        threadId: id,
        role: 'assistant',
        content:
          '```\nhidden.md\n```\n\n[remote](https://example.com/private.md) [label](docs/result.md) `inline.md` plain.md',
        fileSource: {
          stepId: source.step,
          machineId: 'report-runner',
          generation: 1,
          workspace: stamp,
        },
        createdAt: 2,
      })
      .run();
    const response = await s.app.request(`/api/conversations/${id}/messages`);
    expect(await response.json()).toMatchObject({
      messages: [{ workspaceFilePaths: ['docs/result.md', 'inline.md', 'plain.md'] }],
    });
    const open = (path: string) =>
      req(s.app, 'POST', `/api/conversations/${id}/messages/chief-file-message/file`, { path });
    for (const path of ['hidden.md', 'private.md']) expect((await open(path)).status).toBe(404);
    for (const path of ['docs/result.md', 'inline.md', 'plain.md'])
      expect((await open(path)).status).toBe(503);
  } finally {
    s.dispose();
  }
});
