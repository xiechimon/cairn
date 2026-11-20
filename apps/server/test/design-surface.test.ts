import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DesignPageRecord, DesignVersionRecord } from '@cairn/shared';
import { sql } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { prepareFileAttachment } from '../../daemon/src/attach-file.js';
import { attachment, build, designVersion, machine, message, step } from '../src/db/schema.js';
import { hashCredential } from '../src/lib/hash.js';
import { bootServer, postProject, req } from './helpers.js';

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
    'sandbox allow-scripts allow-forms allow-downloads',
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
  expect(printed.headers.get('content-security-policy')).toContain('allow-modals');
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

test('a Word file opens as its paragraphs', async () => {
  const { s, task } = await world();
  const docx = storedZip({
    'word/document.xml':
      '<w:document><w:body><w:p><w:r><w:t>Launch plan</w:t></w:r></w:p><w:p><w:r><w:t>Ship &amp; measure</w:t></w:r></w:p></w:body></w:document>',
  });
  writeFileSync(join(s.attachmentsDir, `${s.team.id}-brief.docx`), docx);
  s.db
    .insert(attachment)
    .values({
      id: 'docx1',
      teamId: s.team.id,
      todoId: task.id,
      createdBy: s.user.id,
      fileName: 'brief.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: docx.length,
      storageKey: `${s.team.id}-brief.docx`,
      grantId: 'g-docx',
      scope: 'message',
      status: 'ready',
      createdAt: 1,
    })
    .run();
  const res = await req(s.app, 'GET', '/api/attachments/docx1/document-preview');
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    kind: 'document',
    sections: [{ lines: ['Launch plan', 'Ship & measure'] }],
  });
});
