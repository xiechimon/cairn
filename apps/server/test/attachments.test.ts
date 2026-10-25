import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { attachment } from '../src/db/schema.js';
import { signAttachmentGrant } from '../src/lib/attachments-token.js';
import { newRecordId } from '../src/lib/ids.js';
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

  test('uploading twice with the same grant -> 201 idempotent (overwrite)', async () => {
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
      const id1 = ((await r1.json()) as { id: string }).id;
      const v2 = new TextEncoder().encode('second\n');
      const r2 = await callMultipart(
        s.app,
        `${g.uploadUrl}/upload`,
        { grant: g.grant },
        { name: 'file', filename: 'spec.md', mimeType: 'text/markdown', bytes: v2 },
      );
      expect(r2.status).toBe(201);
      const id2 = ((await r2.json()) as { id: string }).id;
      expect(id2).toBe(id1);
      const onDisk = readFileSync(`${s.attachmentsDir}/${g.key}`);
      expect(new TextDecoder().decode(onDisk)).toBe('second\n');
    } finally {
      s.dispose();
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
