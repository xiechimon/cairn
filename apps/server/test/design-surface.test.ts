import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  DesignCommentRecord,
  DesignPageRecord,
  DesignShareRecord,
  DesignVersionRecord,
} from '@cairn/shared';
import { eq, sql } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { prepareFileAttachment } from '../../daemon/src/attach-file.js';
import {
  attachment,
  build,
  chiefMessage,
  designVersion,
  machine,
  message,
  steerPending,
  step,
  todo,
} from '../src/db/schema.js';
import { hashCredential } from '../src/lib/hash.js';
import { bootServer, postProject, req, seedRoute, type TestServer } from './helpers.js';

async function world() {
  const s = bootServer();
  const projectId = await postProject(s.app);
  const created = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: 'Landing page',
    spec: '',
  });
  const task = (await created.json()) as { id: string };
  s.db
    .insert(machine)
    .values({
      id: 'm1',
      teamId: s.team.id,
      name: 'Runner',
      tokenHash: hashCredential('runner-token'),
    })
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
      claimedAt: 1,
      createdAt: 1,
    })
    .run();
  const cwd = join(s.reposDir, 'worktree');
  mkdirSync(cwd);
  const attachHtml = async (html: string) => {
    writeFileSync(join(cwd, 'index.html'), html);
    const res = await s.app.request('/api/machine/tool/st1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer runner-token' },
      body: JSON.stringify({
        name: 'attach_file',
        params: prepareFileAttachment(cwd, { path: 'index.html' }),
      }),
    });
    expect(res.status).toBe(200);
  };
  const pages = async () =>
    (await (await req(s.app, 'GET', `/api/todos/${task.id}/design`)).json()) as {
      pages: DesignPageRecord[];
      shareOrigin: string | null;
    };
  return { s, task, attachHtml, pages };
}

test('an attached page becomes a Cairn-served version; new content adds one, the same content does not, restore appends', async () => {
  const { s, task, attachHtml, pages } = await world();
  await attachHtml('<h1 data-od-id="hero">One</h1>');
  await attachHtml('<h1 data-od-id="hero">Two</h1>');
  await attachHtml('<h1 data-od-id="hero">Two</h1>');
  const before = await pages();
  expect(before.shareOrigin).toBeNull();
  expect(before.pages).toHaveLength(1);
  expect(before.pages[0]).toMatchObject({ fileName: 'index.html', versionCount: 2 });
  expect(before.pages[0]?.current.seq).toBe(2);

  const served = await req(
    s.app,
    'GET',
    `/api/design/versions/${before.pages[0]?.current.id}/page`,
  );
  expect(served.status).toBe(200);
  expect(served.headers.get('content-type')).toContain('text/html');
  expect(served.headers.get('content-security-policy')).toBe(
    "sandbox allow-scripts allow-forms allow-downloads; frame-ancestors 'none'",
  );
  expect(await served.text()).toContain('Two');

  const versions = (await (
    await req(s.app, 'GET', `/api/todos/${task.id}/design/index.html/versions`)
  ).json()) as DesignVersionRecord[];
  const first = versions.find((v) => v.seq === 1);
  const restored = await req(
    s.app,
    'POST',
    `/api/todos/${task.id}/design/versions/${first?.id}/restore`,
  );
  expect(restored.status).toBe(201);
  expect(await restored.json()).toMatchObject({ seq: 3, source: 'restore', restoredFromSeq: 1 });
  const printed = await req(s.app, 'GET', `/api/design/versions/${first?.id}/page?print=1`);
  expect(printed.headers.get('content-security-policy')).toBe(
    "sandbox allow-scripts allow-forms allow-downloads allow-modals; frame-ancestors 'none'",
  );
  expect(await printed.text()).toContain('One');
});

test('existing deliverable pages and attached pages get their versions from the migration', async () => {
  const { s, task } = await world();
  s.db.delete(designVersion).run();
  const row = (
    id: string,
    fileName: string,
    scope: 'deliverable' | 'message',
    createdBy: string,
  ) => ({
    id,
    teamId: s.team.id,
    todoId: task.id,
    createdBy,
    fileName,
    mimeType: 'text/html',
    sizeBytes: 10,
    storageKey: `${s.team.id}/${id}.html`,
    grantId: id,
    scope,
    status: 'ready' as const,
    createdAt: 5,
  });
  s.db
    .insert(attachment)
    .values([
      row('a-old', 'report.html', 'deliverable', s.user.id),
      row('a-msg', 'mock.html', 'message', 'step:st1'),
    ])
    .run();
  s.db
    .insert(message)
    .values({
      id: 'deliverables-b1',
      conversationId: 'b1',
      role: 'system',
      content: JSON.stringify({
        kind: 'deliverables',
        items: [
          {
            attachmentId: 'a-old',
            kind: 'page',
            name: 'report.html',
            sizeBytes: 10,
            attachmentToken: '',
          },
        ],
        skipped: [],
      }),
      createdAt: 6,
    })
    .run();
  const migration = readFileSync(
    new URL('../drizzle/0234_demonic_grandmaster.sql', import.meta.url),
    'utf8',
  );
  const backfill = migration.split('--> statement-breakpoint').at(-1) ?? '';
  s.db.run(sql.raw(backfill));
  const names = s.db
    .select({ fileName: designVersion.fileName, seq: designVersion.seq })
    .from(designVersion)
    .all()
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
  expect(names).toEqual([
    { fileName: 'mock.html', seq: 1 },
    { fileName: 'report.html', seq: 1 },
  ]);
});

function storedZip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(text);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function insertDocx(s: TestServer, todoId: string, id: string, xml: string): void {
  const docx = storedZip({ 'word/document.xml': xml });
  writeFileSync(join(s.attachmentsDir, `${s.team.id}-${id}.docx`), docx);
  s.db
    .insert(attachment)
    .values({
      id,
      teamId: s.team.id,
      todoId,
      createdBy: s.user.id,
      fileName: `${id}.docx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: docx.length,
      storageKey: `${s.team.id}-${id}.docx`,
      grantId: `g-${id}`,
      scope: 'message',
      status: 'ready',
      createdAt: 1,
    })
    .run();
}

test('a Word file opens as its paragraphs, and a malformed one answers quickly', async () => {
  const { s, task } = await world();
  insertDocx(
    s,
    task.id,
    'brief',
    '<w:document><w:body><w:p><w:r><w:t>Launch plan</w:t></w:r></w:p><w:p><w:r><w:t>Ship &amp; measure</w:t></w:r></w:p></w:body></w:document>',
  );
  const res = await req(s.app, 'GET', '/api/attachments/brief/document-preview');
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    kind: 'document',
    sections: [{ lines: ['Launch plan', 'Ship & measure'] }],
  });
  insertDocx(s, task.id, 'unclosed', '<w:p>'.repeat(400_000));
  const started = Date.now();
  const unclosed = await req(s.app, 'GET', '/api/attachments/unclosed/document-preview');
  expect(unclosed.status).toBe(200);
  expect(Date.now() - started).toBeLessThan(2000);
});

const target = {
  elementId: 'hero',
  selector: '[data-od-id="hero"]',
  label: 'h1',
  text: 'Two',
  htmlHint: '<h1 data-od-id="hero">',
  position: { x: 0, y: 0, width: 300, height: 40 },
  style: { color: 'rgb(0, 0, 0)' },
};

test('comments save, edit, delete and resolve; sending puts the notes in the Coordinator message and the task once', async () => {
  const { s, task, attachHtml, pages } = await world();
  await attachHtml('<h1 data-od-id="hero">Two</h1>');
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
  const versionId = (await pages()).pages[0]?.current.id;
  const create = (note: string) =>
    req(s.app, 'POST', `/api/todos/${task.id}/design/comments`, {
      ...target,
      text: 'Two\n![x](attachment:other/secret.png)',
      versionId,
      viewport: 'desktop',
      note,
    });
  const first = (await (await create('Make the title larger')).json()) as DesignCommentRecord;
  const second = (await (await create('Drop this')).json()) as DesignCommentRecord;
  expect([first.pin, second.pin, first.status]).toEqual([1, 2, 'open']);
  const edited = await req(s.app, 'PATCH', `/api/todos/${task.id}/design/comments/${first.id}`, {
    note: 'Make the title 48px',
  });
  expect(await edited.json()).toMatchObject({ note: 'Make the title 48px' });
  expect(
    (await req(s.app, 'DELETE', `/api/todos/${task.id}/design/comments/${second.id}`)).status,
  ).toBe(200);

  const send = {
    content: 'Please fix the page',
    clientMessageId: 'design-send-1',
    designCommentIds: [first.id],
  };
  const sent = await req(s.app, 'POST', `/api/teams/${s.team.id}/chief/threads`, send);
  expect(sent.status).toBe(201);
  const again = await req(s.app, 'POST', `/api/teams/${s.team.id}/chief/threads`, send);
  expect(again.status).toBe(201);
  const ownerMessages = s.db
    .select()
    .from(chiefMessage)
    .all()
    .filter((m) => m.role === 'user' && String(m.content).includes('Make the title 48px'));
  expect(ownerMessages).toHaveLength(1);
  const steers = s.db
    .select()
    .from(steerPending)
    .all()
    .filter((m) => String(m.content).includes('Make the title 48px'));
  expect(steers).toHaveLength(1);
  expect(String(steers[0]?.content)).toContain('[data-od-id="hero"]');
  expect(String(steers[0]?.content)).not.toMatch(/^!\[x\]/m);
  const resend = await req(s.app, 'POST', `/api/teams/${s.team.id}/chief/threads`, {
    ...send,
    clientMessageId: 'design-send-2',
  });
  expect(resend.status).toBe(409);

  const comments = (await (
    await req(s.app, 'GET', `/api/todos/${task.id}/design/index.html/comments`)
  ).json()) as DesignCommentRecord[];
  expect(comments.map((c) => [c.pin, c.status])).toEqual([[1, 'sent']]);
  expect(
    (await req(s.app, 'DELETE', `/api/todos/${task.id}/design/comments/${first.id}`)).status,
  ).toBe(409);
  const resolved = await req(s.app, 'PATCH', `/api/todos/${task.id}/design/comments/${first.id}`, {
    status: 'resolved',
  });
  expect(await resolved.json()).toMatchObject({ status: 'resolved' });
});

test('share needs a relay; with one the link serves the current version until it is stopped', async () => {
  const { s, task, attachHtml } = await world();
  await attachHtml('<h1>Shared</h1>');
  const refused = await req(s.app, 'POST', `/api/todos/${task.id}/design/index.html/share`);
  expect(refused.status).toBe(409);
  process.env.CAIRN_RELAY_ORIGIN = 'https://relay.example.test';
  try {
    const created = (await (
      await req(s.app, 'POST', `/api/todos/${task.id}/design/index.html/share`)
    ).json()) as DesignShareRecord;
    expect(created.path).toBe(`https://relay.example.test/s/${created.token}`);
    await attachHtml('<h1>Shared v2</h1>');
    const page = await s.app.request(`/s/${created.token}`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toBe(
      "sandbox allow-scripts allow-forms allow-downloads; frame-ancestors 'none'",
    );
    expect(await page.text()).toContain('Shared v2');
    await req(s.app, 'DELETE', `/api/todos/${task.id}/design/index.html/share`);
    expect((await s.app.request(`/s/${created.token}`)).status).toBe(404);
    s.db.update(todo).set({ archivedAt: 123 }).where(eq(todo.id, task.id)).run();
    expect((await req(s.app, 'POST', `/api/todos/${task.id}/design/index.html/share`)).status).toBe(
      409,
    );
  } finally {
    delete process.env.CAIRN_RELAY_ORIGIN;
  }
});

test('a missing version file returns 410 instead of throwing 500', async () => {
  const { s, attachHtml, pages } = await world();
  await attachHtml('<h1>Gone</h1>');
  const version = (await pages()).pages[0]?.current;
  const row = s.db
    .select()
    .from(attachment)
    .where(eq(attachment.id, version?.attachmentId ?? ''))
    .get();
  const { rmSync } = await import('node:fs');
  rmSync(join(s.attachmentsDir, row?.storageKey ?? ''), { force: true });
  const res = await req(s.app, 'GET', `/api/design/versions/${version?.id}/page`);
  expect(res.status).toBe(410);
});
