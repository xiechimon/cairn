import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';

import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findTicketConflicts, mentionsTicket } from './dispatch-dedupe.mjs';
import { makeTestTempDir } from './test-tmpdir.mjs';

const SCRIPT = fileURLToPath(new URL('./dispatch-agent.mjs', import.meta.url));

const noSources = {
  ticket: '1569',
  selfCwd: '/work/self',
  selfPid: 100,
  dirs: [],
  branches: [],
  prs: [],
  processes: [],
};

test('ticket numbers match only on digit boundaries', () => {
  assert.equal(mentionsTicket('/tmp/pm-1569-1792753069', '1569'), true);
  assert.equal(mentionsTicket('obs/1569-langfuse-selfhost', '1569'), true);
  assert.equal(mentionsTicket('/tmp/pm-15690-x', '1569'), false);
  assert.equal(mentionsTicket('/tmp/pm-21569', '1569'), false);
  assert.equal(mentionsTicket('fix #1569.', '1569'), true);
});

test('no sources hit means no conflicts', () => {
  const result = findTicketConflicts(noSources);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.unchecked, []);
});

test('the 2026-10-24 #1569 workspaces are reported with their branches', () => {
  const result = findTicketConflicts({
    ...noSources,
    dirs: [
      { path: '/tmp/pm-1569-1792753069', branch: 'obs/1569-langfuse-selfhost' },
      { path: '/tmp/pm-1578-1792753069', branch: 'rsi/1578-harness-eval-gate' },
      { path: '/tmp/pm-15690-other', branch: 'x' },
    ],
  });
  assert.deepEqual(result.conflicts, [
    {
      source: 'workdir',
      detail: '/tmp/pm-1569-1792753069 (branch obs/1569-langfuse-selfhost)',
    },
  ]);
});

test('the dispatch target directory itself is not a conflict', () => {
  const result = findTicketConflicts({
    ...noSources,
    selfCwd: '/tmp/cairn-1569-impl',
    dirs: [{ path: '/tmp/cairn-1569-impl', branch: 'lane/1569' }],
  });
  assert.deepEqual(result.conflicts, []);
});

test('remote branches and open PRs mentioning the ticket are conflicts', () => {
  const result = findTicketConflicts({
    ...noSources,
    branches: ['main', 'obs/1569-langfuse-selfhost', 'rsi/15690-x'],
    prs: [
      {
        number: 1601,
        title: 'obs: langfuse self-host',
        headRefName: 'obs/1569-langfuse',
        body: '',
      },
      { number: 1602, title: 'unrelated', headRefName: 'web/x', body: 'see #15690' },
    ],
  });
  assert.deepEqual(
    result.conflicts.map((c) => c.source),
    ['remote-branch', 'pr'],
  );
  assert.match(result.conflicts[0].detail, /obs\/1569-langfuse-selfhost/);
  assert.match(result.conflicts[1].detail, /#1601/);
});

test('a missing gh or git source is reported unchecked, not as clear', () => {
  const result = findTicketConflicts({
    ...noSources,
    branches: null,
    prs: null,
  });
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(
    result.unchecked.map((u) => u.source),
    ['remote-branch', 'pr'],
  );
});

test('running agents mentioning the ticket are conflicts, the dispatch chain is not', () => {
  const result = findTicketConflicts({
    ...noSources,
    selfPid: 300,
    processes: [
      {
        pid: 200,
        ppid: 1,
        command: '/bin/zsh -c node scripts/dispatch-agent.mjs start 1569 -- pi -p 1569',
      },
      {
        pid: 300,
        ppid: 200,
        command: 'node scripts/dispatch-agent.mjs start 1569 --ticket 1569 -- pi -p fix 1569',
      },
      { pid: 400, ppid: 1, command: 'codex exec -s workspace-write -C /tmp/pm-1569-path do it' },
      { pid: 401, ppid: 1, command: '/Users/x/.local/bin/pi -p --thinking low "#1569"' },
      { pid: 402, ppid: 1, command: 'node /Users/x/.grok/bin/grok run 1569' },
      { pid: 403, ppid: 1, command: 'vim notes-1569.md' },
      { pid: 404, ppid: 1, command: 'codex exec -C /tmp/pm-15690 x' },
      { pid: 405, ppid: 1, command: 'codex-code-mode-host 1569' },
    ],
  });
  assert.deepEqual(
    result.conflicts.map((c) => c.detail.split(' ')[1]),
    ['400', '401', '402'],
  );
});

function runCli(args, statusDir) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, CAIRN_DISPATCH_STATUS_DIR: statusDir },
  });
}

test('start --ticket refuses when another git workdir in tmp holds the ticket, --force overrides', () => {
  const ticket = String(900000000 + (process.pid % 99999));
  const statusDir = makeTestTempDir('dispatch-dedupe-status-');
  const rival = makeTestTempDir(`pm-${ticket}-`);
  const selfDir = makeTestTempDir('dispatch-dedupe-self-');
  mkdirSync(join(rival, '.git'));
  try {
    const command = [process.execPath, '-e', 'setTimeout(() => {}, 30000)'];
    const refused = runCli(
      ['start', 'dedupe', '--cwd', selfDir, '--ticket', ticket, '--', ...command],
      statusDir,
    );
    assert.equal(refused.status, 1, `${refused.stdout}${refused.stderr}`);
    assert.ok(refused.stderr.includes(`pm-${ticket}-`), refused.stderr);
    assert.match(refused.stderr, /--force/);

    const forced = runCli(
      ['start', 'dedupe', '--cwd', selfDir, '--ticket', ticket, '--force', '--', ...command],
      statusDir,
    );
    assert.equal(forced.status, 0, `${forced.stdout}${forced.stderr}`);
    const record = JSON.parse(readFileSync(join(statusDir, 'dedupe.json'), 'utf8'));
    process.kill(record.pid, 'SIGKILL');
  } finally {
    rmSync(statusDir, { recursive: true, force: true });
    rmSync(rival, { recursive: true, force: true });
    rmSync(selfDir, { recursive: true, force: true });
  }
});

test('start rejects a non-numeric ticket', () => {
  const statusDir = makeTestTempDir('dispatch-dedupe-status-');
  try {
    const result = runCli(['start', 'bad', '--ticket', 'abc', '--', 'true'], statusDir);
    assert.equal(result.status, 2);
  } finally {
    rmSync(statusDir, { recursive: true, force: true });
  }
});
