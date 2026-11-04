import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

test('capture --video finalizes a real WebM and reports it beside the screenshot', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vp-video-'));
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(
      '<title>Recording probe</title><style>@keyframes slide{to{transform:translateX(200px)}}div{width:40px;height:40px;background:red;animation:slide 1s infinite alternate}</style><div></div>',
    );
  });
  try {
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    writeFileSync(join(dir, 'ports.json'), JSON.stringify({ webPort: server.address().port }));
    const child = spawn(
      process.execPath,
      [
        resolve('.claude/skills/verify-cairn/scripts/vp.mjs'),
        'capture',
        '/app',
        '--video',
        '--wait',
        '300',
      ],
      {
        env: { ...process.env, VERIFY_RUN_DIR: dir, VERIFY_EVIDENCE_DIR: join(dir, 'evidence') },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    const code = await new Promise((done) => child.on('close', done));
    assert.equal(code, 0, output);
    const capture = join(dir, 'evidence/capture-page');
    const result = JSON.parse(readFileSync(join(capture, 'result.json'), 'utf8'));
    assert.match(result.recording, /\.webm$/);
    const file = join(capture, result.recording);
    assert.ok(statSync(file).size > 0);
    assert.ok(statSync(file).size <= 5 * 1024 * 1024);
    assert.equal(readFileSync(file).subarray(0, 4).toString('hex'), '1a45dfa3');
    assert.ok(statSync(join(capture, result.screenshot)).size > 0);
  } finally {
    await new Promise((done) => server.close(done));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('archive rejects oversized recordings before copying evidence', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vp-video-cap-'));
  try {
    mkdirSync(join(dir, 'source'));
    writeFileSync(join(dir, 'source/large.webm'), Buffer.alloc(5 * 1024 * 1024 + 1));
    const child = spawn(
      process.execPath,
      [
        resolve('.claude/skills/verify-cairn/scripts/vp.mjs'),
        'archive',
        '1783',
        '--from',
        join(dir, 'source'),
      ],
      {
        env: { ...process.env, VERIFY_REPO_ROOT: join(dir, 'repo') },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    const code = await new Promise((done) => child.on('close', done));
    assert.equal(code, 1, output);
    assert.match(output, /5 MiB/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
