import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ensureStateDirs, saveMachineJson, statePaths } from '../../../apps/daemon/src/state.js';
import { buildSecretTool } from '../../../apps/daemon/src/secret-channel.js';
import { createEphemeralSecretBox } from '../../../apps/server/src/lib/secret-box.js';
import { createApiKey } from '../../../apps/server/src/services/api-keys.js';
import { uploadFile } from '../../../apps/server/src/services/attachments.js';
import { seedLocalMachine } from '../../../apps/server/src/services/machines.js';
import { bootServer } from '../../../apps/server/test/helpers.js';

const expectSecure = process.argv.includes('--expect-secure');

test('anonymous enrollment confirmation with server authentication enabled', async () => {
  const server = bootServer({ authToken: 'synthetic-owner-token' });
  try {
    const denied = await server.app.request('/api/projects');
    assert.equal(denied.status, 401);
    const start = await server.app.request('/api/machine/enroll/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'audit-machine' }),
    });
    assert.equal(start.status, 200);
    const { enrollId } = (await start.json()) as { enrollId: string };
    const confirm = await server.app.request('/api/machine/enroll/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enrollId }),
    });
    if (expectSecure) {
      assert.equal(confirm.status, 401);
      return;
    }
    assert.equal(confirm.status, 200);
    const { machine } = (await confirm.json()) as { machine: { token: string } };
    const me = await server.app.request('/api/machine/me', {
      headers: { authorization: `Bearer ${machine.token}` },
    });
    assert.equal(me.status, 200);
  } finally {
    server.dispose();
  }
});

test('read-only MCP key can obtain a machine token', async () => {
  const server = bootServer({ authToken: 'synthetic-owner-token' });
  try {
    seedLocalMachine(server.db, server.team.id);
    const key = createApiKey(server, {
      teamId: server.team.id,
      gitAccess: false,
      mcpAccess: true,
      toolGrants: { read: ['Todos'], write: [] },
    });
    const response = await server.app.request('/api/machine/enroll', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key.plaintext}`,
      },
      body: JSON.stringify({ teamId: server.team.id, name: hostname() }),
    });
    assert.equal(response.status, expectSecure ? 403 : 200);
    if (!expectSecure) {
      const machine = (await response.json()) as { token: string };
      const me = await server.app.request('/api/machine/me', {
        headers: { authorization: `Bearer ${machine.token}` },
      });
      const record = (await me.json()) as { kind: string };
      assert.equal(record.kind, 'local');
    }
  } finally {
    server.dispose();
  }
});

test('publicly derived attachment signature permits a write outside the attachment directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'cairn-2000-probe-'));
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
      return;
    }
    upload();
    assert.equal(readFileSync(join(root, 'sentinel.txt'), 'utf8'), 'audit');
  } finally {
    server.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});

test('team secret plaintext reaches the model-facing tool result', async () => {
  const sentinel = 'synthetic-2000-secret';
  const audit: string[] = [];
  const tool = buildSecretTool({
    creds: {
      provider: null,
      git: null,
      secrets: { names: ['AUDIT'], take: (name) => (name === 'AUDIT' ? sentinel : null) },
    },
    stepId: 'audit-step',
    agentId: 'audit-agent',
    onAudit: (line) => audit.push(line),
  });
  const result = await tool.execute({ name: 'AUDIT' });
  assert.equal(result === sentinel, !expectSecure);
  assert.equal(audit.length, 1);
  assert.equal(audit[0]?.includes(sentinel), false);
});

test('MCP rejects missing keys and calls outside the granted tool set', async () => {
  const server = bootServer({ authToken: 'synthetic-owner-token' });
  try {
    const key = createApiKey(server, {
      teamId: server.team.id,
      gitAccess: false,
      mcpAccess: true,
      toolGrants: { read: ['Todos'], write: [] },
    });
    for (const token of [null, key.plaintext]) {
      const response = await server.app.request('/api/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'machines', arguments: {} },
        }),
      });
      if (token === null) {
        assert.equal(response.status, 401);
      } else {
        const body = (await response.json()) as {
          error?: unknown;
          result?: { isError?: boolean };
        };
        assert.ok(body.error || body.result?.isError);
      }
    }
  } finally {
    server.dispose();
  }
});


test('machine bearer token file inherits a world-readable umask', () => {
  const root = mkdtempSync(join(tmpdir(), 'cairn-2000-mode-'));
  const previousUmask = process.umask(0o022);
  try {
    const paths = statePaths(join(root, 'state'));
    ensureStateDirs(paths);
    saveMachineJson(paths, {
      machineId: 'audit-machine',
      token: 'a'.repeat(64),
      teamId: 'a'.repeat(16),
      serverUrl: 'https://audit.invalid',
    });
    assert.equal(statSync(paths.machineJson).mode & 0o077, expectSecure ? 0 : 0o044);
    assert.equal(statSync(paths.home).mode & 0o077, expectSecure ? 0 : 0o055);
  } finally {
    process.umask(previousUmask);
    rmSync(root, { recursive: true, force: true });
  }
});
