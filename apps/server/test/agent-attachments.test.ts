import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WORKER_REMOTE_TOOLS, WORKER_REMOTE_TOOLS_GITHUB } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { expect, test, vi } from 'vitest';
import { prepareFileAttachment } from '../../daemon/src/attach-file.js';
import { attachment, build, machine, message, step, todo } from '../src/db/schema.js';
import { hashCredential } from '../src/lib/hash.js';
import { bootServer, postProject, req } from './helpers.js';

async function world() {
  const s = bootServer();
  const projectId = await postProject(s.app);
  const created = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: 'Attach files',
    spec: '',
  });
  expect(created.status).toBe(201);
  const task = (await created.json()) as { id: string };
  s.db
    .insert(machine)
    .values({
      id: 'owner-machine',
      teamId: s.team.id,
      name: 'Owner machine',
      tokenHash: hashCredential('owner-token'),
    })
    .run();
  s.db
    .insert(build)
    .values({
      id: 'attachment-build',
      todoId: task.id,
      withPlan: false,
      triggerSource: 'user',
      createdAt: 1,
    })
    .run();
  s.db
    .insert(step)
    .values({
      id: 'attachment-step',
      buildId: 'attachment-build',
      kind: 'build',
      status: 'claimed',
      machineId: 'owner-machine',
      createdAt: 1,
    })
    .run();
  const cwd = join(s.reposDir, 'worktree');
  mkdirSync(cwd);
  const bytes = Buffer.from('workspace report\n');
  writeFileSync(join(cwd, 'report.md'), bytes);
  const call = (params: Record<string, unknown>, token = 'owner-token') =>
    s.app.request('/api/machine/tool/attachment-step', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'attach_file', params }),
    });
  return { s, task, cwd, bytes, call };
}

test('worker claims offer attach_file for both project forms', () => {
  for (const tools of [WORKER_REMOTE_TOOLS, WORKER_REMOTE_TOOLS_GITHUB]) {
    expect(tools.find((tool) => tool.name === 'attach_file')).toMatchObject({
      parameters: { required: ['path'] },
    });
  }
});

test('attach_file stores computed bytes/hash and binds output to the step team and todo', async () => {
  const { s, task, cwd, bytes, call } = await world();
  try {
    const response = await call({
      ...prepareFileAttachment(cwd, { path: 'report.md', caption: 'Report' }),
      sha256: 'forged',
      mimeType: 'image/png',
      teamId: 'foreign',
      todoId: 'foreign',
    });
    expect(response.status).toBe(200);
    const { text } = (await response.json()) as { text: string };
    const result = JSON.parse(text) as { id: string; token: string };
    const stored = s.db.select().from(attachment).where(eq(attachment.id, result.id)).get();
    expect(stored).toMatchObject({
      teamId: s.team.id,
      todoId: task.id,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      mimeType: 'text/plain',
      status: 'ready',
      scope: 'message',
    });
    expect(readFileSync(join(s.attachmentsDir, stored!.storageKey))).toEqual(bytes);
    expect(result.token).toBe(`![Report](attachment:${s.team.id}/${result.id}.md)`);
    const output = s.db
      .select()
      .from(message)
      .where(eq(message.conversationId, 'attachment-build'))
      .all();
    expect(output).toEqual([expect.objectContaining({ role: 'assistant', content: result.token })]);
    const download = await s.app.request(`/api/attachments/${result.id}`);
    expect(download.status).toBe(200);
    expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes);
    expect(s.db.select().from(todo).where(eq(todo.id, task.id)).get()?.teamId).toBe(s.team.id);
  } finally {
    s.dispose();
  }
});

test('two uploads append tokens and survive final transcript upload', async () => {
  const { s, cwd, call } = await world();
  try {
    writeFileSync(
      join(cwd, 'screenshot.png'),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP48OHDfxBmgDEAiNQPPZGgNrYAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    for (const caption of ['Light', 'Dark'])
      expect(
        (await call(prepareFileAttachment(cwd, { path: 'screenshot.png', caption }))).status,
      ).toBe(200);
    const urls = await s.app.request('/api/machine/upload-urls/attachment-step', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer owner-token' },
      body: JSON.stringify({ files: [{ name: 'transcript.json' }] }),
    });
    expect(urls.status).toBe(200);
    const { uploads } = (await urls.json()) as { uploads: { url: string }[] };
    const upload = await s.app.request(uploads[0]!.url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: 'Bearer owner-token' },
      body: JSON.stringify({
        stepId: 'attachment-step',
        messages: [{ id: 'final-response', role: 'assistant', content: 'Done', createdAt: 2 }],
      }),
    });
    expect(upload.status).toBe(200);
    const output = s.db
      .select()
      .from(message)
      .all()
      .map((row) => row.content)
      .join('\n');
    expect(output).toContain('![Light](attachment:');
    expect(output).toContain('![Dark](attachment:');
    expect(output).toContain('Done');
  } finally {
    s.dispose();
  }
});

test('rejects another machine and finished steps without creating attachments', async () => {
  const { s, cwd, call } = await world();
  try {
    s.db
      .insert(machine)
      .values({
        id: 'other-machine',
        teamId: s.team.id,
        name: 'Other',
        tokenHash: hashCredential('other-token'),
      })
      .run();
    const payload = prepareFileAttachment(cwd, { path: 'report.md' });
    expect((await call(payload, 'other-token')).status).toBe(404);
    s.db.update(step).set({ status: 'done' }).where(eq(step.id, 'attachment-step')).run();
    expect((await call(payload)).status).toBe(409);
    expect(s.db.select().from(attachment).all()).toEqual([]);
  } finally {
    s.dispose();
  }
});

test.each([
  { fileName: 'large.txt', contentBase64: Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64') },
  { fileName: 'fake.png', contentBase64: Buffer.from('not an image').toString('base64') },
  { fileName: '../escape.txt', contentBase64: 'eA==' },
  { fileName: 'report.txt', contentBase64: 'not-base64' },
  { path: '../outside.txt' },
])('rejects invalid upload without persisting: $fileName', async (params) => {
  const { s, call } = await world();
  try {
    const res = await call(params);
    expect(res.status).toBe(400);
    expect(s.db.select().from(attachment).all()).toEqual([]);
    if (params.fileName === 'large.txt')
      expect(((await res.json()) as { error: string }).error).toMatch(/10 MiB.*cap/i);
  } finally {
    s.dispose();
  }
});

test.each(['svg', 'bmp', 'ico', 'avif', 'exe'])(
  'rejects agent files outside the safe raster and document allowlist: %s',
  async (ext) => {
    const { s, call } = await world();
    try {
      const response = await call({
        fileName: `active.${ext}`,
        contentBase64: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.domain)</script></svg>',
        ).toString('base64'),
      });
      expect(response.status).toBe(400);
      expect(s.db.select().from(attachment).all()).toEqual([]);
      expect(s.db.select().from(message).all()).toEqual([]);
      expect(readdirSync(s.attachmentsDir)).toEqual([]);
    } finally {
      s.dispose();
    }
  },
);

test('removes the stored file when the attachment database transaction fails', async () => {
  const { s, cwd, call } = await world();
  const transaction = vi.spyOn(s.db, 'transaction').mockImplementationOnce(() => {
    throw new Error('attachment transaction failed');
  });
  try {
    const response = await call(prepareFileAttachment(cwd, { path: 'report.md' }));
    expect(response.status).toBe(500);
    expect(transaction).toHaveBeenCalledOnce();
    expect(s.db.select().from(attachment).all()).toEqual([]);
    expect(s.db.select().from(message).all()).toEqual([]);
    expect(readdirSync(join(s.attachmentsDir, s.team.id))).toEqual([]);
  } finally {
    transaction.mockRestore();
    s.dispose();
  }
});
