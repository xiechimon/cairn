import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createEphemeralSecretBox } from '../../../apps/server/src/lib/secret-box.js';
import { uploadFile } from '../../../apps/server/src/services/attachments.js';
import { bootServer } from '../../../apps/server/test/helpers.js';

const expectSecure = process.argv.includes('--expect-secure');

test('publicly derived attachment signature permits a write outside the attachment directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'cairn-2055-probe-'));
  const server = bootServer({ attachmentsDir: join(root, 'attachments') });
  try {
    const payload = {
      attachmentId: 'synthetic-missing-row',
      teamId: server.team.id,
      key: '../sentinel.txt',
      sizeBytes: 5,
      mimeType: 'text/plain',
      scope: 'message',
      exp: Date.now() + 60_000,
    };
    const head = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const key = createHash('sha256').update('attachment-grant-key-v1').digest();
    const signature = createHmac('sha256', key).update(head).digest('base64url');
    const upload = () =>
      uploadFile(
        {
          db: server.db,
          secretBox: createEphemeralSecretBox(),
          attachmentsDir: join(root, 'attachments'),
          teamId: server.team.id,
          userId: server.user.id,
        },
        {
          grant: `${head}.${signature}`,
          fileBytes: new TextEncoder().encode('audit'),
          fileMimeType: 'text/plain',
          fileName: 'sentinel.txt',
        },
      );
    if (expectSecure) {
      assert.throws(upload);
      assert.equal(existsSync(join(root, 'sentinel.txt')), false);
      return;
    }
    upload();
    assert.equal(readFileSync(join(root, 'sentinel.txt'), 'utf8'), 'audit');
  } finally {
    server.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});

test('cross-installation grant signature is rejected under expect-secure', async () => {
  const server = bootServer();
  try {
    const grantRes = await server.app.request('/api/uploads/grant', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'attachment',
        fileName: 'spec.md',
        mimeType: 'text/markdown',
        size: 8,
      }),
    });
    assert.equal(grantRes.status, 200);
    const g = (await grantRes.json()) as { grant: string; key: string };
    const otherBox = createEphemeralSecretBox();
    const upload = () =>
      uploadFile(
        {
          db: server.db,
          secretBox: otherBox,
          attachmentsDir: server.attachmentsDir,
          teamId: server.team.id,
          userId: server.user.id,
        },
        {
          grant: g.grant,
          fileBytes: new TextEncoder().encode('# hello\n'),
          fileMimeType: 'text/markdown',
          fileName: 'spec.md',
        },
      );
    if (expectSecure) {
      assert.throws(upload);
      assert.equal(existsSync(join(server.attachmentsDir, g.key)), false);
      return;
    }
    upload();
    assert.equal(existsSync(join(server.attachmentsDir, g.key)), true);
  } finally {
    server.dispose();
  }
});

test('valid grant upload still succeeds', async () => {
  const server = bootServer();
  try {
    const grantRes = await server.app.request('/api/uploads/grant', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'attachment',
        fileName: 'spec.md',
        mimeType: 'text/markdown',
        size: 8,
      }),
    });
    assert.equal(grantRes.status, 200);
    const g = (await grantRes.json()) as { grant: string; key: string; uploadUrl: string };
    const form = new FormData();
    form.set('grant', g.grant);
    form.set(
      'file',
      new Blob([new Uint8Array(new TextEncoder().encode('# hello\n'))], {
        type: 'text/markdown',
      }),
      'spec.md',
    );
    const up = await server.app.request(`${g.uploadUrl}/upload`, { method: 'POST', body: form });
    assert.equal(up.status, 201);
    assert.equal(readFileSync(join(server.attachmentsDir, g.key), 'utf8'), '# hello\n');
  } finally {
    server.dispose();
  }
});
