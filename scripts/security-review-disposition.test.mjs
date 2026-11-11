import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  dispositionMatches,
  evaluate,
  parseNameStatus,
  touchesSecurity,
} from './security-review-disposition.mjs';

const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const gatePaths = {
  humanQueue: {
    credentials: ['apps/server/src/services/secrets.ts'],
    machineAndCommandBoundary: ['apps/server/src/services/machine*.ts'],
    externalEntryAuth: ['apps/server/src/services/mcp-face.ts'],
  },
};

const recorded = (sha) => `## Risk\n\nSecurity review (${sha}): recorded\n`;

test('a product change needs no security-review line', () => {
  const result = evaluate({
    body: '## What\nno surface\n',
    nameStatus: 'M\tapps/web/src/a.ts\n',
    head: HEAD,
    gatePaths,
  });
  assert.equal(result.ok, true);
});

test('a security surface without a head-bound line fails', () => {
  const result = evaluate({
    body: '## Risk\nfindings noted, but not bound to the head\n',
    nameStatus: 'M\tapps/server/src/services/secrets.ts\n',
    head: HEAD,
    gatePaths,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /Security review/);
});

test('a line for another head does not admit this head', () => {
  const result = evaluate({
    body: recorded(OTHER),
    nameStatus: 'A\tapps/server/src/services/mcp-face.ts\n',
    head: HEAD,
    gatePaths,
  });
  assert.equal(result.ok, false);
});

test('fixed and recorded both admit the exact head', () => {
  for (const verb of ['fixed', 'recorded']) {
    const result = evaluate({
      body: `Security review (${HEAD}): ${verb}\n`,
      nameStatus: 'M\tapps/server/src/services/machine-client.ts\n',
      head: HEAD,
      gatePaths,
    });
    assert.equal(result.ok, true, verb);
  }
});

test('a fenced example of the line does not count', () => {
  assert.equal(
    dispositionMatches(`\`\`\`\nSecurity review (${HEAD}): recorded\n\`\`\`\n`, HEAD),
    false,
  );
});

test('a tilde fence, an HTML comment and an indented code line do not count', () => {
  for (const body of [
    `~~~\nSecurity review (${HEAD}): recorded\n~~~\n`,
    `<!-- Security review (${HEAD}): recorded -->\n`,
    `    Security review (${HEAD}): recorded\n`,
  ])
    assert.equal(dispositionMatches(body, HEAD), false, body);
});

test('the workflow runs the base copy of the checker, not the PR copy', () => {
  const yaml = readFileSync('.github/workflows/pr-evidence.yml', 'utf8');
  assert.match(yaml, /git show "\$BASE_SHA:scripts\/security-review-disposition.mjs"/);
  assert.doesNotMatch(yaml, /node scripts\/security-review-disposition.mjs/);
});

test('a rename out of a security surface still needs the line', () => {
  const files = parseNameStatus(
    'R100\tapps/server/src/services/secrets.ts\tapps/web/src/secrets.ts\n',
  );
  assert.equal(touchesSecurity(files, ['apps/server/src/services/secrets.ts'], false), true);
  const result = evaluate({
    body: recorded(HEAD),
    nameStatus: 'R100\tapps/server/src/services/secrets.ts\tapps/web/src/secrets.ts\n',
    head: HEAD,
    gatePaths,
  });
  assert.equal(result.ok, true);
});

test('a deleted security file needs the line', () => {
  const result = evaluate({
    body: '## What\ndeleted the surface\n',
    nameStatus: 'D\tapps/server/src/services/secrets.ts\n',
    head: HEAD,
    gatePaths,
  });
  assert.equal(result.ok, false);
});

test('editing the path list needs the line even when no surface file changed', () => {
  const result = evaluate({
    body: recorded(HEAD),
    nameStatus: 'M\tpackages/shared/merge-gate-paths.json\n',
    head: HEAD,
    gatePaths,
    pathsFileTouched: true,
  });
  assert.equal(result.ok, true);
  const missing = evaluate({
    body: '## What\nloosened the list\n',
    nameStatus: 'M\tpackages/shared/merge-gate-paths.json\n',
    head: HEAD,
    gatePaths,
    pathsFileTouched: true,
  });
  assert.equal(missing.ok, false);
});

test('a malformed head fails closed', () => {
  const result = evaluate({
    body: recorded(HEAD),
    nameStatus: 'M\tapps/web/src/a.ts\n',
    head: 'HEAD',
    gatePaths,
  });
  assert.equal(result.ok, false);
});
