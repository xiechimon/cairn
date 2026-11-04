import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { docReaderTests } from './doc-reader-tests.mjs';

const index = {
  'docs/ops/agent-bot-identity.md': ['apps/server/test/codeowners.test.ts'],
  'docs/lessons/README.md': [
    'scripts/agent-rules.test.mjs',
    'apps/server/test/codeowners.test.ts',
    'integration/test/skills-routing-e2e.test.ts',
    'apps/daemon/test/local-executor.test.ts',
  ],
  'README.md': ['apps/daemon/test/workspace.test.ts'],
};
const grep = (doc) => index[doc] ?? [];

test('a doc change selects the tests that name it, split by runner', () => {
  assert.deepEqual(
    docReaderTests(
      ['docs/ops/agent-bot-identity.md', 'docs/lessons/README.md', 'docs/unread.md'],
      grep,
      ['apps/daemon/test/local-executor.test.ts'],
    ),
    {
      node: ['scripts/agent-rules.test.mjs'],
      vitest: ['apps/server/test/codeowners.test.ts'],
    },
  );
});

test('root-level doc names, integration suites and known-red files are not selected', () => {
  assert.deepEqual(docReaderTests(['README.md', 'AGENTS.md'], grep, []), { node: [], vitest: [] });
  assert.deepEqual(
    docReaderTests(['docs/lessons/README.md'], grep, ['apps/daemon/test/local-executor.test.ts'])
      .vitest,
    ['apps/server/test/codeowners.test.ts'],
  );
});

test('the retired collector archive is excluded while current identity safeguards remain selected', () => {
  const knownRed = JSON.parse(
    readFileSync(new URL('./prepush-known-red.json', import.meta.url), 'utf8'),
  ).map((entry) => entry.file);
  assert.deepEqual(
    docReaderTests(
      ['docs/ops/agent-bot-identity.md'],
      () => [
        'docs/verify/2136/review-check.test.mjs',
        'scripts/commit-author-recovery.test.mjs',
        'apps/server/test/codeowners.test.ts',
      ],
      knownRed,
    ),
    {
      node: ['scripts/commit-author-recovery.test.mjs'],
      vitest: ['apps/server/test/codeowners.test.ts'],
    },
  );
});
