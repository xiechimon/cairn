import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { escalationPending, readEvents } from './lessons-ledger-gate.mjs';

const script = join(import.meta.dirname, 'lessons-weekly.mjs');

function repo(events = [], entries = ['comment-discipline']) {
  const root = mkdtempSync(join(tmpdir(), 'lessons-weekly-'));
  mkdirSync(join(root, 'docs/lessons'), { recursive: true });
  for (const name of entries)
    writeFileSync(
      join(root, 'docs/lessons', `2001-${name}.md`),
      `---\nCategory: ${name} kind\nSource: #1\nLevel: 2\nSafeguard: \`scripts/${name}-gate.mjs\`; since 2026-10-20\nIntercepts: 0\nRecurrences: 0\nNotes: kept\n---\n`,
    );
  if (events.length > 0)
    writeFileSync(
      join(root, 'docs/lessons/events.jsonl'),
      events.map((e) => `${JSON.stringify(e)}\n`).join(''),
    );
  return root;
}

const intercept = (overrides = {}) => ({
  kind: 'intercept',
  repo: 'xiechimon/cairn',
  branch: 'lane/2040',
  at: '2026-10-27T08:00:00Z',
  category: 'comment-discipline',
  gate: 'scripts/comment-discipline-gate.mjs',
  id: 'intercept:xiechimon/cairn:lane/2040:comment-discipline:scripts/comment-discipline-gate.mjs',
  ...overrides,
});

const recurrence = (overrides = {}) => ({
  kind: 'recurrence',
  repo: 'xiechimon/cairn',
  pr: '2043',
  at: '2026-10-27T09:00:00Z',
  category: 'comment-discipline',
  id: 'recurrence:xiechimon/cairn+2043:xiechimon/cairn#2043:comment-discipline',
  ...overrides,
});

function fakeGh(calls) {
  return (args) => {
    calls.push(args);
    if (args[0] === 'issue' && args[1] === 'list') return '';
    if (args[0] === 'issue' && args[1] === 'create') {
      calls.created = (calls.created ?? 0) + 1;
      return `https://github.com/xiechimon/cairn/issues/${2077 + calls.created - 1}\n`;
    }
    if (args[0] === 'issue' && args[1] === 'view') return '';
    throw new Error(`unexpected gh call: ${args.join(' ')}`);
  };
}

test('an empty ledger writes a report that says so and files nothing', async () => {
  const { runWeekly } = await import('./lessons-weekly.mjs');
  const root = repo();
  const calls = [];
  try {
    const report = await runWeekly({
      root,
      out: join(root, 'out'),
      now: new Date('2026-11-02T01:23:00Z'),
      gh: fakeGh(calls),
    });
    assert.match(report.text, /Intercepts: 0/);
    assert.match(report.text, /Recurrences: 0/);
    assert.equal(calls.length, 0);
    assert.match(readFileSync(report.path, 'utf8'), /Lessons ledger weekly summary/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a normal week reports its counts and leaves a filed recurrence alone', async () => {
  const { runWeekly } = await import('./lessons-weekly.mjs');
  const root = repo([intercept(), recurrence({ issue: '2070' })]);
  const calls = [];
  try {
    const report = await runWeekly({
      root,
      out: join(root, 'out'),
      now: new Date('2026-10-28T12:00:00Z'),
      gh: fakeGh(calls),
    });
    assert.match(report.text, /Intercepts: 1/);
    assert.match(report.text, /Recurrences: 1/);
    assert.match(report.text, /Escalations filed: 1/);
    assert.equal(calls.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a pending escalation is filed once, and a rerun finds the issue instead of filing again', async () => {
  const { runWeekly } = await import('./lessons-weekly.mjs');
  const root = repo([
    recurrence({
      suggestedLevel: 1,
      suggestion: 'move it',
      upgradedEntry: '2001-comment-discipline.md',
    }),
  ]);
  const calls = [];
  try {
    const first = await runWeekly({
      root,
      out: join(root, 'out'),
      now: new Date('2026-10-28T12:00:00Z'),
      gh: fakeGh(calls),
    });
    assert.equal(calls.created, 1);
    assert.equal(first.filed.length, 1);
    assert.equal(first.filed[0].issue, '2077');
    const recorded = readEvents(root);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].issue, '2077');
    assert.deepEqual(escalationPending(recorded), []);

    const listed = [];
    const second = await runWeekly({
      root,
      out: join(root, 'out'),
      now: new Date('2026-10-28T12:00:00Z'),
      gh: (args) => {
        listed.push(args);
        return '';
      },
    });
    assert.deepEqual(second.filed, []);
    assert.equal(listed.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a failed issue creation leaves the recurrence pending for the next run', async () => {
  const { runWeekly } = await import('./lessons-weekly.mjs');
  const root = repo([
    recurrence({
      suggestedLevel: 1,
      suggestion: 'move it',
      upgradedEntry: '2001-comment-discipline.md',
    }),
  ]);
  try {
    const report = await runWeekly({
      root,
      out: join(root, 'out'),
      now: new Date('2026-10-28T12:00:00Z'),
      gh: () => {
        throw new Error('gh: HTTP 502');
      },
    });
    assert.match(report.text, /Escalations awaiting an issue:\n- comment-discipline/);
    assert.equal(readEvents(root)[0].issue, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the CLI writes the report where --out points and prints it', () => {
  const root = repo([intercept()]);
  try {
    const out = join(root, 'gardener-summary');
    const stdout = execFileSync(
      process.execPath,
      [script, '--out', out, '--now', '2026-10-28T12:00:00Z', '--no-file'],
      { cwd: root, encoding: 'utf8' },
    );
    assert.match(stdout, /Lessons ledger weekly summary/);
    assert.match(stdout, /Intercepts: 1/);
    assert.match(readFileSync(join(out, 'lessons-weekly-2026-10-28.md'), 'utf8'), /Intercepts: 1/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('weekly collection deduplicates external logs and persists projected counters', async () => {
  const { runWeekly } = await import('./lessons-weekly.mjs');
  const root = repo();
  const logs = join(root, 'logs');
  mkdirSync(logs);
  writeFileSync(
    join(logs, 'gate-log.jsonl'),
    `${JSON.stringify(intercept())}\n${JSON.stringify(intercept())}\n`,
  );
  try {
    for (let retry = 0; retry < 2; retry++)
      await runWeekly({ root, out: join(root, 'out'), logs, file: false });
    assert.equal(readEvents(root).length, 1);
    assert.match(
      readFileSync(join(root, 'docs/lessons/2001-comment-discipline.md'), 'utf8'),
      /^Intercepts: 1$/m,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('merged recurrence increases file one issue and replay does not duplicate it', async () => {
  const { runWeekly } = await import('./lessons-weekly.mjs');
  const root = repo();
  const git = (...args) =>
    execFileSync(
      'git',
      ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args],
      { cwd: root, encoding: 'utf8' },
    );
  try {
    git('init');
    git('add', 'docs');
    git('commit', '-m', 'initial safeguard');
    const path = join(root, 'docs/lessons/2001-comment-discipline.md');
    writeFileSync(path, readFileSync(path, 'utf8').replace('Recurrences: 0', 'Recurrences: 1'));
    git('add', 'docs');
    git('commit', '-m', 'fix recurrence (#2043)');
    const calls = [];
    const options = {
      root,
      out: join(root, 'out'),
      gh: fakeGh(calls),
      now: new Date('2026-11-02T01:23:00Z'),
    };
    const first = await runWeekly(options);
    assert.equal(first.filed.length, 1);
    assert.equal(calls.created, 1);
    assert.equal(readEvents(root).filter((e) => e.kind === 'recurrence').length, 1);
    await runWeekly(options);
    assert.equal(calls.created, 1);
    assert.match(readFileSync(path, 'utf8'), /^Recurrences: 1$/m);
    git('add', 'docs');
    git('commit', '-m', 'publish weekly counters');
    await runWeekly(options);
    assert.equal(calls.created, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
