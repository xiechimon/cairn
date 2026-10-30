import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./dispatch-agent.mjs', import.meta.url));

function runCli(args, statusDir) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, CAIRN_DISPATCH_STATUS_DIR: statusDir },
  });
}

async function waitUntilDead(pid) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }
  assert.fail(`pid ${pid} is still signalable`);
}

test('start verifies the process and writes the status file', async () => {
  const statusDir = mkdtempSync(join(tmpdir(), 'dispatch-agent-test-'));
  const workDir = mkdtempSync(join(tmpdir(), 'dispatch-agent-cwd-'));
  try {
    const result = runCli(
      [
        'start',
        'job',
        '--cwd',
        workDir,
        '--',
        process.execPath,
        '-e',
        'console.log(process.cwd()); setTimeout(() => {}, 30000)',
      ],
      statusDir,
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    const record = JSON.parse(readFileSync(join(statusDir, 'job.json'), 'utf8'));
    assert.equal(record.alive, true);
    assert.equal(record.cwd, workDir);
    assert.ok(record.pid > 0);
    assert.ok(readFileSync(record.log, 'utf8').includes(workDir));
    process.kill(record.pid, 'SIGKILL');
  } finally {
    rmSync(statusDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('check reports alive while the job runs and missing after it exits', async () => {
  const statusDir = mkdtempSync(join(tmpdir(), 'dispatch-agent-test-'));
  try {
    const start = runCli(
      ['start', 'short', '--', process.execPath, '-e', 'setTimeout(() => {}, 3000)'],
      statusDir,
    );
    assert.equal(start.status, 0, `${start.stdout}${start.stderr}`);
    const record = JSON.parse(readFileSync(join(statusDir, 'short.json'), 'utf8'));
    const first = runCli(['check', 'short'], statusDir);
    assert.equal(first.status, 0, `${first.stdout}${first.stderr}`);
    assert.match(first.stdout, new RegExp(`pid ${record.pid} alive`));
    await waitUntilDead(record.pid);
    const second = runCli(['check', 'short'], statusDir);
    assert.equal(second.status, 1);
    assert.match(`${second.stdout}${second.stderr}`, /process missing/);
    assert.equal(JSON.parse(readFileSync(join(statusDir, 'short.json'), 'utf8')).alive, false);
  } finally {
    rmSync(statusDir, { recursive: true, force: true });
  }
});

test('a job started with the old nohup syntax is reported missing', async () => {
  const statusDir = mkdtempSync(join(tmpdir(), 'dispatch-agent-test-'));
  try {
    const toolCall = spawn(
      '/bin/bash',
      [
        '-c',
        `nohup ${process.execPath} -e "setTimeout(() => {}, 60000)" >/dev/null 2>&1 & echo $!`,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'], detached: true },
    );
    const oldPid = Number(
      await new Promise((resolve) => {
        let out = '';
        toolCall.stdout.on('data', (chunk) => {
          out += chunk;
        });
        toolCall.stdout.on('end', () => resolve(out));
      }).then((out) => out.trim()),
    );
    assert.ok(Number.isInteger(oldPid) && oldPid > 0, `unexpected pid ${oldPid}`);
    process.kill(-toolCall.pid, 'SIGKILL');
    await waitUntilDead(oldPid);
    const check = runCli(['check', 'oldway'], statusDir);
    assert.equal(check.status, 1);
    assert.match(`${check.stdout}${check.stderr}`, /process missing/);
  } finally {
    rmSync(statusDir, { recursive: true, force: true });
  }
});

test('the boundary teardown kills the old-style job and spares the dispatched job', async () => {
  const statusDir = mkdtempSync(join(tmpdir(), 'dispatch-agent-test-'));
  try {
    const toolCall = spawn(
      '/bin/bash',
      [
        '-c',
        `nohup sleep 60 >/dev/null 2>&1 & echo $!; ${process.execPath} ${SCRIPT} start survivor -- sleep 60`,
      ],
      {
        stdio: ['ignore', 'pipe', 'ignore'],
        detached: true,
        env: { ...process.env, CAIRN_DISPATCH_STATUS_DIR: statusDir },
      },
    );
    const output = await new Promise((resolve) => {
      let out = '';
      toolCall.stdout.on('data', (chunk) => {
        out += chunk;
      });
      toolCall.stdout.on('end', () => resolve(out));
    });
    const oldPid = Number(output.split('\n')[0]);
    assert.ok(Number.isInteger(oldPid) && oldPid > 0, `unexpected pid ${oldPid}`);
    process.kill(-toolCall.pid, 'SIGKILL');
    await waitUntilDead(oldPid);
    const check = runCli(['check', 'survivor'], statusDir);
    assert.equal(check.status, 0, `${check.stdout}${check.stderr}`);
    assert.match(check.stdout, /alive/);
    const record = JSON.parse(readFileSync(join(statusDir, 'survivor.json'), 'utf8'));
    process.kill(record.pid, 'SIGKILL');
  } finally {
    rmSync(statusDir, { recursive: true, force: true });
  }
});

test('start reports missing when the command dies immediately', () => {
  const statusDir = mkdtempSync(join(tmpdir(), 'dispatch-agent-test-'));
  try {
    const result = runCli(
      ['start', 'instant', '--', process.execPath, '-e', 'process.exit(3)'],
      statusDir,
    );
    assert.equal(result.status, 1);
    assert.match(`${result.stdout}${result.stderr}`, /process missing/);
    assert.equal(JSON.parse(readFileSync(join(statusDir, 'instant.json'), 'utf8')).alive, false);
  } finally {
    rmSync(statusDir, { recursive: true, force: true });
  }
});

test('start reports missing when the command cannot spawn', () => {
  const statusDir = mkdtempSync(join(tmpdir(), 'dispatch-agent-test-'));
  try {
    const result = runCli(['start', 'ghost', '--', '/no/such/binary'], statusDir);
    assert.equal(result.status, 1);
    assert.match(`${result.stdout}${result.stderr}`, /process missing/);
    assert.equal(JSON.parse(readFileSync(join(statusDir, 'ghost.json'), 'utf8')).alive, false);
  } finally {
    rmSync(statusDir, { recursive: true, force: true });
  }
});

test('wait accepts a successful child regardless of its log text', async () => {
  const statusDir = mkdtempSync(join(tmpdir(), 'dispatch-agent-test-'));
  try {
    const start = runCli(
      [
        'start',
        'banned',
        '--',
        process.execPath,
        '-e',
        'setTimeout(() => { console.log("ai-route: implement -> pi:domestic-proxy/deepseek-v4-flash"); process.exit(0); }, 800)',
      ],
      statusDir,
    );
    assert.equal(start.status, 0, `${start.stdout}${start.stderr}`);
    const wait = runCli(['wait', 'banned', '--timeout-s', '10'], statusDir);
    assert.equal(wait.status, 0, `${wait.stdout}${wait.stderr}`);
    assert.match(wait.stdout, /wait ok/);
    const record = JSON.parse(readFileSync(join(statusDir, 'banned.json'), 'utf8'));
    assert.equal(record.exitGate, undefined);
  } finally {
    rmSync(statusDir, { recursive: true, force: true });
  }
});

test('wait fails when the child exits non-zero after start returns', async () => {
  const statusDir = mkdtempSync(join(tmpdir(), 'dispatch-agent-test-'));
  try {
    const start = runCli(
      [
        'start',
        'fail-late',
        '--',
        process.execPath,
        '-e',
        'setTimeout(() => { console.log("late failure"); process.exit(7); }, 800)',
      ],
      statusDir,
    );
    assert.equal(start.status, 0, `${start.stdout}${start.stderr}`);
    const wait = runCli(['wait', 'fail-late', '--timeout-s', '10'], statusDir);
    assert.equal(wait.status, 1, `${wait.stdout}${wait.stderr}`);
    assert.match(`${wait.stdout}${wait.stderr}`, /nonzero-rc|exited 7/);
    const record = JSON.parse(readFileSync(join(statusDir, 'fail-late.json'), 'utf8'));
    assert.equal(record.exitCode, 7);
  } finally {
    rmSync(statusDir, { recursive: true, force: true });
  }
});

test('wait ok when the child exits 0 after start returns with an ordinary log', async () => {
  const statusDir = mkdtempSync(join(tmpdir(), 'dispatch-agent-test-'));
  try {
    const start = runCli(
      [
        'start',
        'ok-late',
        '--',
        process.execPath,
        '-e',
        'setTimeout(() => { console.log("finished real work"); process.exit(0); }, 800)',
      ],
      statusDir,
    );
    assert.equal(start.status, 0, `${start.stdout}${start.stderr}`);
    const wait = runCli(['wait', 'ok-late', '--timeout-s', '10'], statusDir);
    assert.equal(wait.status, 0, `${wait.stdout}${wait.stderr}`);
    assert.match(wait.stdout, /wait ok/);
    const record = JSON.parse(readFileSync(join(statusDir, 'ok-late.json'), 'utf8'));
    assert.equal(record.exitCode, 0);
  } finally {
    rmSync(statusDir, { recursive: true, force: true });
  }
});
