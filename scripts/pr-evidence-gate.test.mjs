import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const gate = resolve(import.meta.dirname, 'pr-evidence-gate.py');
const repo = 'https://raw.githubusercontent.com/xiechimon/cairn/';
const archived = `${repo}abc12345/docs/verify/1810/proof.png`;

const run = (answer, extra = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'pr-evidence-'));
  const body = join(dir, 'body.md');
  writeFileSync(body, `## Upstream\n\nNone.\n\n## Verified\n\n${answer}\n`);
  const result = spawnSync('python3', [gate, body], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PR_EVIDENCE_HTTP_CODE: '200',
      PR_REPO: 'xiechimon/cairn',
      PR_TICKET: '1810',
      ...extra,
    },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};

const cases = [
  ['archived evidence passed', `![proof](${archived})`, 0, null],
  [
    'markdown fixture page',
    '![fixture](https://example.org/view.png?scenario=board)',
    1,
    'fixture-page',
  ],
  [
    'html fixture page',
    '<img src="https://example.org/view.png?scenario=board">',
    1,
    'fixture-page',
  ],
  [
    'extensionless fixture page',
    '![fixture](https://example.org/view?scenario=board)',
    1,
    'fixture-page',
  ],
  [
    'fixture behind another query parameter',
    '![fixture](https://example.org/view.png?theme=dark&scenario=board)',
    1,
    'fixture-page',
  ],
  [
    'srcset fixture page',
    '<picture><source srcset="https://example.org/view.png?scenario=board 2x"><img src="https://example.org/view.png?scenario=board"></picture>',
    1,
    'fixture-page',
  ],
  ['raw link outside the archive', `![proof](${repo}abc12345/proof.png)`, 1, 'not-archived'],
  [
    'raw link from another repository archive',
    '![proof](https://raw.githubusercontent.com/other/repo/main/docs/verify/999/proof.png)',
    1,
    'not-archived',
  ],
  [
    'uploaded attachment instead of an archive',
    '![proof](https://user-images.githubusercontent.com/123/proof.png)',
    1,
    'not-archived',
  ],
  [
    'attachment URL instead of an archive',
    '![proof](https://github.com/user-attachments/assets/0f0aa08c-proof)',
    1,
    'not-archived',
  ],
  [
    'release asset instead of an archive',
    '![proof](https://github.com/xiechimon/cairn/releases/download/v1/proof.png)',
    1,
    'not-archived',
  ],
  ['external host image', '![proof](https://example.org/proof.png)', 1, 'not-archived'],
  [
    'archive for another issue',
    `![proof](${repo}abc12345/docs/verify/999/proof.png)`,
    1,
    'not-archived',
  ],
];

for (const [name, answer, status, finding] of cases) {
  test(`${name}`, () => {
    const result = run(answer);
    if (finding) assert.match(result.output, new RegExp(`FAIL ${finding}\\b`));
    assert.equal(result.status, status, result.output);
  });
}

test('a body without a ticket only settles the repository', () => {
  const answer = `![proof](${repo}abc12345/docs/verify/999/proof.png)`;
  const withTicket = run(answer);
  assert.equal(withTicket.status, 1, withTicket.output);
  const withoutTicket = run(answer, { PR_TICKET: '' });
  assert.equal(withoutTicket.status, 0, withoutTicket.output);
});

test('help names the environment the archive rule reads', () => {
  const result = spawnSync('python3', [gate, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /PR_REPO/);
  assert.match(result.stdout, /PR_TICKET/);
});
