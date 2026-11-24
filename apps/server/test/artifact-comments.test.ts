import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ArtifactOfAttachment, DesignCommentRecord, DesignPageRecord } from '@cairn/shared';
import { eq, sql } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { prepareFileAttachment } from '../../daemon/src/attach-file.js';
import {
  attachment,
  build,
  chiefMessage,
  designVersion,
  machine,
  steerPending,
  step,
  todo,
} from '../src/db/schema.js';
import { hashCredential } from '../src/lib/hash.js';
import { bootServer, postProject, req, seedRoute } from './helpers.js';

const PDF_V1 = '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n';
const PDF_V2 = '%PDF-1.4\n2 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n';

async function world() {
  const s = bootServer();
  const projectId = await postProject(s.app);
  const created = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: 'Export resume',
    spec: '',
  });
  const task = (await created.json()) as { id: string };
  s.db
    .insert(machine)
    .values({ id: 'm1', teamId: s.team.id, name: 'Runner', tokenHash: hashCredential('rt') })
    .run();
  s.db
    .insert(build)
    .values({ id: 'b1', todoId: task.id, withPlan: false, triggerSource: 'user', createdAt: 1 })
    .run();
  s.db
    .insert(step)
    .values({
      id: 'st1',
      buildId: 'b1',
      kind: 'build',
      status: 'claimed',
      machineId: 'm1',
      createdAt: 1,
    })
    .run();
  const cwd = join(s.reposDir, 'worktree');
  mkdirSync(cwd);
  const attach = async (name: string, body: string) => {
    writeFileSync(join(cwd, name), body);
    const res = await s.app.request('/api/machine/tool/st1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer rt' },
      body: JSON.stringify({
        name: 'attach_file',
        params: prepareFileAttachment(cwd, { path: name }),
      }),
    });
    expect(res.status, await res.text()).toBe(200);
  };
  const pages = async () =>
    (
      (await (await req(s.app, 'GET', `/api/todos/${task.id}/design`)).json()) as {
        pages: DesignPageRecord[];
      }
    ).pages;
  return { s, task, attach, pages };
}

const region = {
  elementId: '',
  selector: '',
  label: '选中区域',
  text: '多智能体编排平台（个人项目）',
  htmlHint: '',
  position: { x: 0, y: 0, width: 0, height: 0 },
  style: null,
  anchor: { type: 'region', page: 1, rect: { x: 0.1, y: 0.42, width: 0.8, height: 0.1 } },
  viewport: 'desktop',
};

test('a PDF a task attaches twice is one artifact with two versions, and its attachment names the artifact', async () => {
  const { s, attach, pages } = await world();
  await attach('resume.pdf', PDF_V1);
  await attach('resume.pdf', PDF_V2);
  const list = await pages();
  expect(list.map((p) => [p.fileName, p.kind, p.versionCount])).toEqual([['resume.pdf', 'pdf', 2]]);
  const current = list[0]?.current.attachmentId;
  const artifact = (await (
    await req(s.app, 'GET', `/api/attachments/${current}/artifact`)
  ).json()) as ArtifactOfAttachment;
  expect(artifact).toMatchObject({
    fileName: 'resume.pdf',
    kind: 'pdf',
    versionSeq: 2,
    versionCount: 2,
  });
});

test('a region comment on a PDF goes to the Coordinator as one compact batch, turns handled on the next version, and can be pointed again', async () => {
  const { s, task, attach, pages } = await world();
  await attach('resume.pdf', PDF_V1);
  s.db
    .update(todo)
    .set({ latestBuildId: 'b1', phase: 'building' })
    .where(eq(todo.id, task.id))
    .run();
  seedRoute(s, 'coordinator', {
    id: 'agent-coordinator',
    provider: 'stub-gw',
    modelId: 'stub-model',
  });
  const versionId = (await pages())[0]?.current.id;
  const saved = await req(s.app, 'POST', `/api/todos/${task.id}/design/comments`, {
    ...region,
    versionId,
    note: '把这段经历挪到前面',
  });
  expect(saved.status).toBe(201);
  const comment = (await saved.json()) as DesignCommentRecord;
  expect(comment).toMatchObject({ anchor: region.anchor, sentAt: null, handledSeq: null });

  const sent = await req(s.app, 'POST', `/api/teams/${s.team.id}/chief/threads`, {
    content: '',
    clientMessageId: 'artifact-batch-1',
    designCommentIds: [comment.id],
  });
  expect(sent.status).toBe(201);
  const owner = s.db
    .select()
    .from(chiefMessage)
    .all()
    .find((m) => m.role === 'user' && String(m.content).includes('把这段经历挪到前面'));
  expect(String(owner?.content)).toContain(
    '批注 1 条 · resume.pdf 第 1 版\n① 把这段经历挪到前面\n「多智能体编排平台（个人项目）」',
  );
  const steer = s.db
    .select()
    .from(steerPending)
    .all()
    .find((m) => String(m.content).includes('把这段经历挪到前面'));
  expect(String(steer?.content)).toContain('第 1 页的选区');

  const listed = async () =>
    (await (
      await req(s.app, 'GET', `/api/todos/${task.id}/design/resume.pdf/comments`)
    ).json()) as DesignCommentRecord[];
  const afterSend = (await listed())[0];
  expect(afterSend?.status).toBe('sent');
  expect(afterSend?.sentAt).toEqual(expect.any(Number));
  expect(afterSend?.handledSeq).toBeNull();

  await attach('resume.pdf', PDF_V2);
  expect((await listed())[0]?.handledSeq).toBe(2);

  const retarget = await req(
    s.app,
    'PATCH',
    `/api/todos/${task.id}/design/comments/${comment.id}`,
    {
      retarget: {
        ...region,
        versionId: (await pages())[0]?.current.id,
        anchor: { type: 'region', page: 1, rect: { x: 0.1, y: 0.2, width: 0.8, height: 0.1 } },
      },
    },
  );
  expect(retarget.status).toBe(200);
  expect(await retarget.json()).toMatchObject({
    status: 'open',
    sentAt: null,
    versionSeq: 2,
    anchor: { rect: { y: 0.2 } },
  });
});

test('an anchor that does not fit the file kind is refused', async () => {
  const { s, task, attach, pages } = await world();
  await attach('pace_calc.py', 'print(1)\n');
  const versionId = (await pages())[0]?.current.id;
  const res = await req(s.app, 'POST', `/api/todos/${task.id}/design/comments`, {
    ...region,
    versionId,
    note: 'x',
  });
  expect(res.status).toBe(400);
  const lines = await req(s.app, 'POST', `/api/todos/${task.id}/design/comments`, {
    ...region,
    anchor: { type: 'lines', from: 1, to: 1 },
    versionId,
    note: '步速公式写错了',
  });
  expect(lines.status).toBe(201);
});

test('a whiteboard the user edits in the panel is saved as a new version', async () => {
  const { s, task, attach } = await world();
  const scene = { type: 'excalidraw', version: 2, elements: [], appState: {} };
  await attach('roles.excalidraw', JSON.stringify(scene));
  const edited = { ...scene, elements: [{ id: 'note-1', type: 'rectangle' }] };
  const saved = await req(s.app, 'POST', `/api/todos/${task.id}/design/roles.excalidraw/versions`, {
    content: JSON.stringify(edited),
  });
  expect(saved.status).toBe(201);
  expect(await saved.json()).toMatchObject({ seq: 2, source: 'user' });
  const bad = await req(s.app, 'POST', `/api/todos/${task.id}/design/roles.excalidraw/versions`, {
    content: 'not json',
  });
  expect(bad.status).toBe(400);
});

test('existing non-page task files get their first version from the migration', async () => {
  const { s, task } = await world();
  s.db.delete(designVersion).run();
  s.db
    .insert(attachment)
    .values({
      id: 'a-pdf',
      teamId: s.team.id,
      todoId: task.id,
      createdBy: 'step:st1',
      fileName: 'resume.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      storageKey: `${s.team.id}/a-pdf.pdf`,
      grantId: 'g-pdf',
      scope: 'message',
      status: 'ready',
      createdAt: 5,
    })
    .run();
  const migration = readFileSync(
    new URL('../drizzle/0252_artifact_comments.sql', import.meta.url),
    'utf8',
  );
  const backfill = migration.split('--> statement-breakpoint').at(-1) ?? '';
  s.db.run(sql.raw(backfill));
  expect(
    s.db
      .select({ fileName: designVersion.fileName, seq: designVersion.seq })
      .from(designVersion)
      .all(),
  ).toEqual([{ fileName: 'resume.pdf', seq: 1 }]);
});

test('only an html page is served or shared as a page; other artifacts stay downloads', async () => {
  const { s, task, attach, pages } = await world();
  await attach('notes.md', '<script>alert(1)</script>');
  const version = (await pages()).find((p) => p.fileName === 'notes.md')?.current.id;
  expect(version).toBeDefined();
  const page = await req(s.app, 'GET', `/api/design/versions/${version}/page`);
  expect(page.status).toBe(404);
  expect(page.headers.get('content-type') ?? '').not.toContain('text/html');
  process.env.CAIRN_RELAY_ORIGIN = 'https://relay.example.test';
  try {
    const share = await req(s.app, 'POST', `/api/todos/${task.id}/design/notes.md/share`);
    expect(share.status).toBe(404);
  } finally {
    delete process.env.CAIRN_RELAY_ORIGIN;
  }
});
