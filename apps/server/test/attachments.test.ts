import { createHash, createHmac } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { attachment } from '../src/db/schema.js';
import { signAttachmentGrant } from '../src/lib/attachments-token.js';
import { newRecordId } from '../src/lib/ids.js';
import { createEphemeralSecretBox } from '../src/lib/secret-box.js';
import { TEAM_ATTACHMENTS_QUOTA_BYTES } from '../src/services/attachment-gc.js';
import { uploadFile } from '../src/services/attachments.js';
import { bootServer, postProject, req } from './helpers.js';

type TestServer = ReturnType<typeof bootServer>;

const MAX_BYTES = 10 * 1024 * 1024;

async function uploadOne(
  s: TestServer,
  fileName: string,
  mimeType: string,
  bytes: Uint8Array,
): Promise<{ id: string; key: string; sizeBytes: number }> {
  const grantRes = await req(s.app, 'POST', '/api/uploads/grant', {
    kind: 'attachment',
    fileName,
    mimeType,
    size: bytes.byteLength,
  });
  const g = (await grantRes.json()) as { uploadUrl: string; grant: string; key: string };
  const upRes = await callMultipart(
    s.app,
    `${g.uploadUrl}/upload`,
    { grant: g.grant },
    { name: 'file', filename: fileName, mimeType, bytes },
  );
  return (await upRes.json()) as { id: string; key: string; sizeBytes: number };
}

async function callMultipart(
  app: import('hono').Hono,
  path: string,
  fields: Record<string, string>,
  file: { name: string; filename: string; mimeType: string; bytes: Uint8Array },
): Promise<Response> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  form.set(
    file.name,
    new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }),
    file.filename,
  );
  return app.request(path, { method: 'POST', body: form });
}

describe('attachments -- grant side', () => {
  test('valid request -> 200 {uploadUrl, grant, key}; grant is base64url(payload).hmac', async () => {
    const s = bootServer();
    try {
      const res = await req(s.app, 'POST', '/api/uploads/grant', {
        kind: 'attachment',
        fileName: 'spec.md',
        mimeType: 'text/markdown',
        size: 42,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        uploadUrl: string;
        grant: string;
        key: string;
      };
      expect(body.uploadUrl).toBe('/api/uploads');
      expect(body.grant.split('.').length).toBe(2);
      expect(body.key).toMatch(/^[^/]+\/[^/]+\.md$/);
    } finally {
      s.dispose();
    }
  });

  test.each([
    { body: {}, label: 'empty body' },
    { body: { kind: 'attachment' }, label: 'missing fileName/mimeType/size' },
    {
      body: { kind: 'attachment', fileName: 'x.md', mimeType: 'text/markdown', size: 0 },
      label: 'size=0',
    },
    {
      body: { kind: 'attachment', fileName: 'x.md', mimeType: 'text/markdown', size: -1 },
      label: 'negative size',
    },
    {
      body: {
        kind: 'attachment',
        fileName: 'x.md',
        mimeType: 'text/markdown',
        size: MAX_BYTES + 1,
      },
      label: 'over 10MiB',
    },
    {
      body: { kind: 'attachment', fileName: '', mimeType: 'text/markdown', size: 1 },
      label: 'empty fileName',
    },
    {
      body: { kind: 'attachment', fileName: '../etc/passwd', mimeType: 'text/plain', size: 1 },
      label: 'fileName traversal',
    },
    {
      body: { kind: 'attachment', fileName: 'a/b.md', mimeType: 'text/markdown', size: 1 },
      label: 'fileName with slash',
    },
    {
      body: {
        kind: 'attachment',
        fileName: 'x.exe',
        mimeType: 'application/x-msdownload',
        size: 1,
      },
      label: 'exe mime rejected',
    },
    {
      body: { kind: 'junk', fileName: 'x.md', mimeType: 'text/markdown', size: 1 },
      label: 'unknown kind',
    },
  ])('$label -> 400', async (case_) => {
    const s = bootServer();
    try {
      const res = await req(s.app, 'POST', '/api/uploads/grant', case_.body);
      expect(res.status).toBe(400);
    } finally {
      s.dispose();
    }
  });
});

describe('attachments -- upload side', () => {
  async function grant(
    s: TestServer,
    body: Partial<{ fileName: string; mimeType: string; size: number }> = {},
  ) {
    const res = await req(s.app, 'POST', '/api/uploads/grant', {
      kind: 'attachment',
      fileName: 'spec.md',
      mimeType: 'text/markdown',
      size: 8,
      ...body,
    });
    return (await res.json()) as {
      uploadUrl: string;
      grant: string;
      key: string;
      attachmentId: string;
    };
  }

  test('valid grant + valid file -> 201; file on disk; DB row ready', async () => {
    const s = bootServer();
    try {
      const g = await grant(s);
      const bytes = new TextEncoder().encode('# hello\n');
      const res = await callMultipart(
        s.app,
        `${g.uploadUrl}/upload`,
        { grant: g.grant },
        { name: 'file', filename: 'spec.md', mimeType: 'text/markdown', bytes },
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string; key: string; sizeBytes: number };
      expect(body.id).toBeTruthy();
      expect(body.key).toBe(g.key);
      expect(body.sizeBytes).toBe(bytes.byteLength);
      const row = s.db.select().from(attachment).where(eq(attachment.id, body.id)).get();
      expect(row).toBeTruthy();
      expect(row?.status).toBe('ready');
      const onDisk = readFileSync(`${s.attachmentsDir}/${g.key}`);
      expect(onDisk.byteLength).toBe(bytes.byteLength);
      expect(new TextDecoder().decode(onDisk)).toBe('# hello\n');
    } finally {
      s.dispose();
    }
  });

  test('missing grant -> 401', async () => {
    const s = bootServer();
    try {
      const bytes = new TextEncoder().encode('x');
      const res = await callMultipart(
        s.app,
        '/api/uploads/upload',
        {},
        { name: 'file', filename: 'spec.md', mimeType: 'text/markdown', bytes },
      );
      expect(res.status).toBe(401);
    } finally {
      s.dispose();
    }
  });

  test('grant signature altered -> 401', async () => {
    const s = bootServer();
    try {
      const g = await grant(s);
      const parts = g.grant.split('.');
      const head = parts[0] ?? '';
      const sig = parts[1] ?? '';
      const tampered = `${head}.${sig.slice(0, -2)}AA`;
      const bytes = new TextEncoder().encode('x');
      const res = await callMultipart(
        s.app,
        `${g.uploadUrl}/upload`,
        { grant: tampered },
        { name: 'file', filename: 'spec.md', mimeType: 'text/markdown', bytes },
      );
      expect(res.status).toBe(401);
    } finally {
      s.dispose();
    }
  });

  test('grant expired (exp -1ms) -> 401', async () => {
    const s = bootServer();
    try {
      const payload = {
        attachmentId: newRecordId(),
        teamId: s.team.id,
        grantId: newRecordId(),
        key: 'attachments/x/y.md',
        sizeBytes: 1,
        mimeType: 'text/markdown',
        scope: 'message' as const,
        exp: Date.now() - 1,
      };
      const token = signAttachmentGrant(s.secretBox, payload);
      const bytes = new TextEncoder().encode('x');
      const res = await callMultipart(
        s.app,
        '/api/uploads/upload',
        { grant: token },
        { name: 'file', filename: 'spec.md', mimeType: 'text/markdown', bytes },
      );
      expect(res.status).toBe(401);
    } finally {
      s.dispose();
    }
  });

  test('size does not match grant.sizeBytes -> 409', async () => {
    const s = bootServer();
    try {
      const g = await grant(s, { size: 5 });
      const bytes = new TextEncoder().encode('a longer body than expected');
      const res = await callMultipart(
        s.app,
        `${g.uploadUrl}/upload`,
        { grant: g.grant },
        { name: 'file', filename: 'spec.md', mimeType: 'text/markdown', bytes },
      );
      expect(res.status).toBe(409);
    } finally {
      s.dispose();
    }
  });

  test('mime mismatch -> 409', async () => {
    const s = bootServer();
    try {
      const g = await grant(s, { mimeType: 'text/markdown' });
      const bytes = new TextEncoder().encode('x');
      const res = await callMultipart(
        s.app,
        `${g.uploadUrl}/upload`,
        { grant: g.grant },
        { name: 'file', filename: 'spec.md', mimeType: 'text/plain', bytes },
      );
      expect(res.status).toBe(409);
    } finally {
      s.dispose();
    }
  });

  test('uploading twice with the same grant -> 409 single-use', async () => {
    const s = bootServer();
    try {
      const g = await grant(s, { size: 7 });
      const v1 = new TextEncoder().encode('second\n');
      const r1 = await callMultipart(
        s.app,
        `${g.uploadUrl}/upload`,
        { grant: g.grant },
        { name: 'file', filename: 'spec.md', mimeType: 'text/markdown', bytes: v1 },
      );
      expect(r1.status).toBe(201);
      const v2 = new TextEncoder().encode('second\n');
      const r2 = await callMultipart(
        s.app,
        `${g.uploadUrl}/upload`,
        { grant: g.grant },
        { name: 'file', filename: 'spec.md', mimeType: 'text/markdown', bytes: v2 },
      );
      expect(r2.status).toBe(409);
      const onDisk = readFileSync(`${s.attachmentsDir}/${g.key}`);
      expect(new TextDecoder().decode(onDisk)).toBe('second\n');
    } finally {
      s.dispose();
    }
  });
});

describe('attachments -- #2055 signing key and path containment', () => {
  test('forged public-constant grant with traversal key -> 401; nothing written outside', () => {
    const root = mkdtempSync(join(tmpdir(), 'cairn-2055-forge-'));
    const attachmentsDir = join(root, 'attachments');
    mkdirSync(attachmentsDir);
    const s = bootServer({ attachmentsDir });
    try {
      const payload = {
        attachmentId: 'synthetic-missing-row',
        teamId: s.team.id,
        key: '../sentinel.txt',
        sizeBytes: 5,
        mimeType: 'text/plain',
        scope: 'message',
        exp: Date.now() + 60_000,
      };
      const head = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const key = createHash('sha256').update('attachment-grant-key-v1').digest();
      const signature = createHmac('sha256', key).update(head).digest('base64url');
      expect(() =>
        uploadFile(
          {
            db: s.db,
            secretBox: createEphemeralSecretBox(),
            attachmentsDir,
            teamId: s.team.id,
            userId: s.user.id,
          },
          {
            grant: `${head}.${signature}`,
            fileBytes: new TextEncoder().encode('audit'),
            fileMimeType: 'text/plain',
            fileName: 'sentinel.txt',
          },
        ),
      ).toThrow(/401|grant/);
      expect(existsSync(join(root, 'sentinel.txt'))).toBe(false);
    } finally {
      s.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('grant signed on server A fails upload on server B (cross-installation)', async () => {
    const a = bootServer();
    try {
      const grantRes = await req(a.app, 'POST', '/api/uploads/grant', {
        kind: 'attachment',
        fileName: 'spec.md',
        mimeType: 'text/markdown',
        size: 8,
      });
      expect(grantRes.status).toBe(200);
      const g = (await grantRes.json()) as { grant: string; key: string };
      const otherBox = createEphemeralSecretBox();
      expect(() =>
        uploadFile(
          {
            db: a.db,
            secretBox: otherBox,
            attachmentsDir: a.attachmentsDir,
            teamId: a.team.id,
            userId: a.user.id,
          },
          {
            grant: g.grant,
            fileBytes: new TextEncoder().encode('# hello\n'),
            fileMimeType: 'text/markdown',
            fileName: 'spec.md',
          },
        ),
      ).toThrow(/401|grant|signature/);
      expect(existsSync(join(a.attachmentsDir, g.key))).toBe(false);
    } finally {
      a.dispose();
    }
  });

  test('server-signed grant with no pending row -> 409; no write', () => {
    const s = bootServer();
    try {
      const attachmentId = newRecordId();
      const key = `${s.team.id}/${attachmentId}.md`;
      const token = signAttachmentGrant(s.secretBox, {
        attachmentId,
        teamId: s.team.id,
        grantId: newRecordId(),
        key,
        sizeBytes: 5,
        mimeType: 'text/markdown',
        scope: 'message',
        exp: Date.now() + 60_000,
      });
      expect(() =>
        uploadFile(
          {
            db: s.db,
            secretBox: s.secretBox,
            attachmentsDir: s.attachmentsDir,
            teamId: s.team.id,
            userId: s.user.id,
          },
          {
            grant: token,
            fileBytes: new TextEncoder().encode('hello'),
            fileMimeType: 'text/markdown',
            fileName: 'spec.md',
          },
        ),
      ).toThrow(/409|pending|missing|grant/);
      expect(existsSync(join(s.attachmentsDir, key))).toBe(false);
    } finally {
      s.dispose();
    }
  });

  test('server-signed grant whose key differs from row.storageKey -> 409; no write', async () => {
    const s = bootServer();
    try {
      const grantRes = await req(s.app, 'POST', '/api/uploads/grant', {
        kind: 'attachment',
        fileName: 'spec.md',
        mimeType: 'text/markdown',
        size: 5,
      });
      const g = (await grantRes.json()) as {
        grant: string;
        key: string;
        attachmentId: string;
      };
      const row = s.db.select().from(attachment).where(eq(attachment.id, g.attachmentId)).get();
      expect(row?.grantId).toBeTruthy();
      const forgedKey = `${s.team.id}/${newRecordId()}.md`;
      const token = signAttachmentGrant(s.secretBox, {
        attachmentId: g.attachmentId,
        teamId: s.team.id,
        grantId: row?.grantId ?? '',
        key: forgedKey,
        sizeBytes: 5,
        mimeType: 'text/markdown',
        scope: 'message',
        exp: Date.now() + 60_000,
      });
      expect(() =>
        uploadFile(
          {
            db: s.db,
            secretBox: s.secretBox,
            attachmentsDir: s.attachmentsDir,
            teamId: s.team.id,
            userId: s.user.id,
          },
          {
            grant: token,
            fileBytes: new TextEncoder().encode('hello'),
            fileMimeType: 'text/markdown',
            fileName: 'spec.md',
          },
        ),
      ).toThrow(/409|storageKey|key|mismatch|does not match/);
      expect(existsSync(join(s.attachmentsDir, forgedKey))).toBe(false);
      expect(existsSync(join(s.attachmentsDir, g.key))).toBe(false);
    } finally {
      s.dispose();
    }
  });

  test('consumption quota re-check rejects when team usage crosses limit', async () => {
    const s = bootServer();
    try {
      const grantRes = await req(s.app, 'POST', '/api/uploads/grant', {
        kind: 'attachment',
        fileName: 'spec.md',
        mimeType: 'text/markdown',
        size: 8,
      });
      expect(grantRes.status).toBe(200);
      const g = (await grantRes.json()) as { grant: string; key: string; attachmentId: string };
      s.db
        .insert(attachment)
        .values({
          id: newRecordId(),
          teamId: s.team.id,
          createdBy: s.user.id,
          fileName: 'hog.bin',
          mimeType: 'text/plain',
          sizeBytes: TEAM_ATTACHMENTS_QUOTA_BYTES,
          storageKey: `${s.team.id}/${newRecordId()}.txt`,
          grantId: newRecordId(),
          scope: 'message',
          status: 'ready',
          createdAt: Date.now(),
        })
        .run();
      const bytes = new TextEncoder().encode('# hello\n');
      const res = await callMultipart(
        s.app,
        '/api/uploads/upload',
        { grant: g.grant },
        { name: 'file', filename: 'spec.md', mimeType: 'text/markdown', bytes },
      );
      expect([400, 409]).toContain(res.status);
      expect(await res.text()).toMatch(/quota/);
      expect(existsSync(join(s.attachmentsDir, g.key))).toBe(false);
      const row = s.db.select().from(attachment).where(eq(attachment.id, g.attachmentId)).get();
      expect(row?.status).toBe('pending');
    } finally {
      s.dispose();
    }
  });

  test('teamId directory replaced with symlink outside attachmentsDir is rejected', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cairn-2055-symlink-'));
    const attachmentsDir = join(root, 'attachments');
    const outside = join(root, 'outside');
    mkdirSync(attachmentsDir);
    mkdirSync(outside);
    const s = bootServer({ attachmentsDir });
    try {
      const grantRes = await req(s.app, 'POST', '/api/uploads/grant', {
        kind: 'attachment',
        fileName: 'spec.md',
        mimeType: 'text/markdown',
        size: 8,
      });
      expect(grantRes.status).toBe(200);
      const g = (await grantRes.json()) as { grant: string; key: string };
      const teamDir = join(attachmentsDir, s.team.id);
      if (existsSync(teamDir)) rmSync(teamDir, { recursive: true, force: true });
      symlinkSync(outside, teamDir);
      const bytes = new TextEncoder().encode('# hello\n');
      const res = await callMultipart(
        s.app,
        '/api/uploads/upload',
        { grant: g.grant },
        { name: 'file', filename: 'spec.md', mimeType: 'text/markdown', bytes },
      );
      expect(res.status).toBeGreaterThanOrEqual(400);
      const fileName = g.key.split('/').pop() ?? '';
      expect(existsSync(join(outside, fileName))).toBe(false);
    } finally {
      s.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('destination file symlink outside attachmentsDir is rejected; outside unchanged', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cairn-2055-leaf-symlink-'));
    const attachmentsDir = join(root, 'attachments');
    const outside = join(root, 'outside');
    const outsideTarget = join(outside, 'leaked.md');
    mkdirSync(attachmentsDir);
    mkdirSync(outside);
    writeFileSync(outsideTarget, 'sentinel-before');
    const s = bootServer({ attachmentsDir });
    try {
      const grantRes = await req(s.app, 'POST', '/api/uploads/grant', {
        kind: 'attachment',
        fileName: 'spec.md',
        mimeType: 'text/markdown',
        size: 8,
      });
      expect(grantRes.status).toBe(200);
      const g = (await grantRes.json()) as {
        grant: string;
        key: string;
        attachmentId: string;
      };
      const dest = join(attachmentsDir, g.key);
      mkdirSync(dirname(dest), { recursive: true });
      symlinkSync(outsideTarget, dest);
      const bytes = new TextEncoder().encode('# hello\n');
      const res = await callMultipart(
        s.app,
        '/api/uploads/upload',
        { grant: g.grant },
        { name: 'file', filename: 'spec.md', mimeType: 'text/markdown', bytes },
      );
      expect(res.status).toBe(400);
      expect(readFileSync(outsideTarget, 'utf8')).toBe('sentinel-before');
      const row = s.db.select().from(attachment).where(eq(attachment.id, g.attachmentId)).get();
      expect(row?.status).toBe('pending');
    } finally {
      s.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('attachments -- read side', () => {
  test('valid id -> 200 + binary', async () => {
    const s = bootServer();
    try {
      const grantRes = await req(s.app, 'POST', '/api/uploads/grant', {
        kind: 'attachment',
        fileName: 'spec.md',
        mimeType: 'text/markdown',
        size: 6,
      });
      const g = (await grantRes.json()) as {
        uploadUrl: string;
        grant: string;
        key: string;
        attachmentId: string;
      };
      const bytes = new TextEncoder().encode('# hi!\n');
      const up = await callMultipart(
        s.app,
        `${g.uploadUrl}/upload`,
        { grant: g.grant },
        { name: 'file', filename: 'spec.md', mimeType: 'text/markdown', bytes },
      );
      const { id } = (await up.json()) as { id: string };
      const r = await s.app.request(`/api/attachments/${id}`);
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toContain('text/markdown');
      const buf = new Uint8Array(await r.arrayBuffer());
      expect(new TextDecoder().decode(buf)).toBe('# hi!\n');
    } finally {
      s.dispose();
    }
  });

  test('nonexistent id -> 404', async () => {
    const s = bootServer();
    try {
      const r = await s.app.request('/api/attachments/does-not-exist');
      expect(r.status).toBe(404);
    } finally {
      s.dispose();
    }
  });
});

describe('attachments — chief-tools / mcp-face tool', () => {
  test('chief-tools attachment text/* → utf8', async () => {
    const s = bootServer();
    try {
      const { id } = await uploadOne(
        s,
        'spec.md',
        'text/markdown',
        new TextEncoder().encode('hello'),
      );
      const { executeChiefTool } = await import('../src/services/chief-tools.js');
      const text = await executeChiefTool(
        {
          db: s.db,
          hub: s.hub,
          box: s.secretBox,
          user: s.user,
          reposDir: s.reposDir,
          attachmentsDir: s.attachmentsDir,
          skillsDir: s.skillsDir,
        },
        {
          teamId: s.team.id,
          userId: s.user.id,
          chiefId: 'chief-x',
          threadId: 'thread-x',
          chiefAgentId: null,
          conversationId: 'conv-x',
        },
        'attachment',
        { attachmentId: id },
      );
      const out = JSON.parse(text);
      expect(out.id).toBe(id);
      expect(out.fileName).toBe('spec.md');
      expect(out.mimeType).toBe('text/markdown');
      expect(out.encoding).toBe('utf8');
      expect(out.content).toBe('hello');
    } finally {
      s.dispose();
    }
  });

  test('chief-tools attachment image/* → base64', async () => {
    const s = bootServer();
    try {
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      const { id } = await uploadOne(s, 'tiny.png', 'image/png', bytes);
      const { executeChiefTool } = await import('../src/services/chief-tools.js');
      const text = await executeChiefTool(
        {
          db: s.db,
          hub: s.hub,
          box: s.secretBox,
          user: s.user,
          reposDir: s.reposDir,
          attachmentsDir: s.attachmentsDir,
          skillsDir: s.skillsDir,
        },
        {
          teamId: s.team.id,
          userId: s.user.id,
          chiefId: 'chief-x',
          threadId: 'thread-x',
          chiefAgentId: null,
          conversationId: 'conv-x',
        },
        'attachment',
        { attachmentId: id },
      );
      const out = JSON.parse(text);
      expect(out.encoding).toBe('base64');
      expect(out.content).toBe(Buffer.from(bytes).toString('base64'));
    } finally {
      s.dispose();
    }
  });

  test('chief-tools attachment unknown id -> throws 404', async () => {
    const s = bootServer();
    try {
      const { executeChiefTool } = await import('../src/services/chief-tools.js');
      await expect(
        executeChiefTool(
          {
            db: s.db,
            hub: s.hub,
            box: s.secretBox,
            user: s.user,
            reposDir: s.reposDir,
            attachmentsDir: s.attachmentsDir,
            skillsDir: s.skillsDir,
          },
          {
            teamId: s.team.id,
            userId: s.user.id,
            chiefId: 'chief-x',
            threadId: 'thread-x',
            chiefAgentId: null,
            conversationId: 'conv-x',
          },
          'attachment',
          { attachmentId: 'no-such' },
        ),
      ).rejects.toThrow(/404|attachment/);
    } finally {
      s.dispose();
    }
  });
});

async function todoCiting(s: TestServer, attachmentId: string, ext: string): Promise<string> {
  const projectId = await postProject(s.app);
  const res = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: 'Attachment text',
    spec: `![file](attachment:${s.team.id}/${attachmentId}.${ext})`,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

describe('attachments -- worker-step relay (#310/r9 section 3.1: spec `attachment:` token parse path)', () => {
  test('worker attachment text/* → utf8', async () => {
    const s = bootServer();
    try {
      const { id } = await uploadOne(
        s,
        'spec.md',
        'text/markdown',
        new TextEncoder().encode('hello'),
      );
      const todoId = await todoCiting(s, id, 'md');
      const { executeWorkerMemoryTool } = await import('../src/services/chief-tools.js');
      const text = await executeWorkerMemoryTool(
        s.db,
        {
          teamId: s.team.id,
          agentId: 'a',
          todoId,
          projectId: 'p',
          buildId: 'b',
          attachmentsDir: s.attachmentsDir,
        },
        'attachment',
        { attachmentId: id },
      );
      const out = JSON.parse(text);
      expect(out.id).toBe(id);
      expect(out.fileName).toBe('spec.md');
      expect(out.mimeType).toBe('text/markdown');
      expect(out.encoding).toBe('utf8');
      expect(out.content).toBe('hello');
    } finally {
      s.dispose();
    }
  });

  test('worker attachment image/* → base64', async () => {
    const s = bootServer();
    try {
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      const { id } = await uploadOne(s, 'tiny.png', 'image/png', bytes);
      const todoId = await todoCiting(s, id, 'png');
      const { executeWorkerMemoryTool } = await import('../src/services/chief-tools.js');
      const text = await executeWorkerMemoryTool(
        s.db,
        {
          teamId: s.team.id,
          agentId: 'a',
          todoId,
          projectId: 'p',
          buildId: 'b',
          attachmentsDir: s.attachmentsDir,
        },
        'attachment',
        { attachmentId: id },
      );
      const out = JSON.parse(text);
      expect(out.encoding).toBe('base64');
      expect(out.content).toBe(Buffer.from(bytes).toString('base64'));
    } finally {
      s.dispose();
    }
  });

  test('worker attachment unknown id -> throws 404', async () => {
    const s = bootServer();
    try {
      const { executeWorkerMemoryTool } = await import('../src/services/chief-tools.js');
      await expect(
        executeWorkerMemoryTool(
          s.db,
          {
            teamId: s.team.id,
            agentId: 'a',
            todoId: 't',
            projectId: 'p',
            buildId: 'b',
            attachmentsDir: s.attachmentsDir,
          },
          'attachment',
          { attachmentId: 'no-such' },
        ),
      ).rejects.toThrow(/404|attachment/);
    } finally {
      s.dispose();
    }
  });

  test('worker attachment cross-team -> 404 (mismatched teamId is not found)', async () => {
    const sA = bootServer();
    const sB = bootServer();
    try {
      const { id } = await uploadOne(sA, 'spec.md', 'text/markdown', new TextEncoder().encode('x'));
      const { executeWorkerMemoryTool } = await import('../src/services/chief-tools.js');
      await expect(
        executeWorkerMemoryTool(
          sB.db,
          {
            teamId: sB.team.id,
            agentId: 'a',
            todoId: 't',
            projectId: 'p',
            buildId: 'b',
            attachmentsDir: sB.attachmentsDir,
          },
          'attachment',
          { attachmentId: id },
        ),
      ).rejects.toThrow(/404|attachment/);
    } finally {
      sA.dispose();
      sB.dispose();
    }
  });
});
