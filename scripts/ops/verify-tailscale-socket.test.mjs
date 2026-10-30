import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifyTailscaleSocket } from './verify-tailscale-socket.mjs';

test('host probe rejects a regular file in a scratch directory before making requests', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'c2057-probe-'));
  try {
    const socketPath = join(dir, 'socket');
    writeFileSync(socketPath, 'preserve');
    await assert.rejects(
      verifyTailscaleSocket({
        socketPath,
        tcpUrl: 'http://127.0.0.1:1',
        login: 'owner',
        token: 'fixture-token',
      }),
      /socket/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('host probe refuses missing credentials and non-loopback TCP targets', async () => {
  await assert.rejects(verifyTailscaleSocket({ token: '' }), /token/);
  await assert.rejects(
    verifyTailscaleSocket({
      token: 'fixture-token',
      tcpUrl: 'https://example.com',
      login: 'owner',
      socketPath: '/unused',
    }),
    /loopback/,
  );
});
