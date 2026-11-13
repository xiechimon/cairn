import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { ticketLinkProblem, ticketOf } from './pr-ticket-link.mjs';
import { makeTestTempDir, releaseTestTempDir } from './test-tmpdir.mjs';

const script = resolve('scripts/pr-ticket-link.mjs');
const title = 'server(3849): switch memory callers to versioned documents';

test('the ticket is the number in the title scope, with or without #', () => {
  assert.equal(ticketOf(title), 3849);
  assert.equal(ticketOf('shared(#1970): suppress weak domain signals'), 1970);
  assert.equal(ticketOf('web+server+daemon(3512): answer by request id'), 3512);
  assert.equal(ticketOf('chore(1834): detect silent reverts (#1834) (#1848)'), 1834);
});

test('titles without a numeric ticket need no link', () => {
  for (const t of [
    'fix(web): keep the trace hairlines',
    'ops(D117): emulator evidence',
    'server(CN-116): persist summary titles',
    'Revert "server(3849): switch memory callers"',
    'merge queue: merged #4327: refactor(daemon): move builders',
    'docs: fold docs/plans into docs/design (3476)',
  ]) {
    assert.equal(ticketOf(t), null, t);
    assert.equal(ticketLinkProblem({ title: t, body: '', commits: '' }), null, t);
  }
});

test('a closing keyword or Part of for the title ticket passes, in the body or a commit', () => {
  for (const body of [
    'Closes #3849',
    '## What\n\nSwitch callers.\n\ncloses #3849.',
    'Fixes: #3849',
    'Resolved #3849',
    'Fix #3849 and refs #3664',
    'Part of #3849',
    'part of  #3849, after #3831',
  ])
    assert.equal(ticketLinkProblem({ title, body, commits: '' }), null, body);
  assert.equal(
    ticketLinkProblem({ title, body: 'Refs #3849', commits: 'server(3849): x\n\nfixes #3849\n' }),
    null,
  );
});

test('a mention that GitHub would not close or that names another issue fails', () => {
  for (const body of [
    '',
    'Refs #3849',
    'Implements #3849',
    'server(3849) lands segment 3b',
    'Closes #38490',
    'Closes #384',
    'Closes #3858',
    'Encloses #3849',
    'Prefixes #3849',
    'Part of #38491',
    '<!-- Closes #3849 -->',
    '```\nCloses #3849\n```',
    'Run `closes #3849` in the merge message.',
  ])
    assert.match(
      ticketLinkProblem({ title, body, commits: 'server(3849): x\n\nRefs #3849\n' }) ?? '',
      /Closes #3849.*Part of #3849/,
      body,
    );
});

test('the CLI exits 1 with the reason and 0 once the body links the ticket', (t) => {
  const dir = makeTestTempDir('pr-ticket-link-');
  t.after(() => releaseTestTempDir(dir));
  const body = join(dir, 'body.md');
  const commits = join(dir, 'commits.txt');
  writeFileSync(commits, 'server(3849): x\n');
  const run = () =>
    spawnSync('node', [script, '--title', title, '--body', body, '--commits', commits], {
      encoding: 'utf8',
    });
  writeFileSync(body, '## What\n\nRefs #3849\n');
  const red = run();
  assert.equal(red.status, 1);
  assert.match(red.stdout + red.stderr, /#3849/);
  writeFileSync(body, '## What\n\nCloses #3849\n');
  const green = run();
  assert.equal(green.status, 0, green.stdout + green.stderr);
});
