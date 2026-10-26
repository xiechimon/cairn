import assert from 'node:assert/strict';
import test from 'node:test';
import { docReaderTests } from './doc-reader-tests.mjs';

const index = {
  'docs/ops/agent-bot-identity.md': ['apps/server/test/codeowners.test.ts'],
  'docs/lessons.md': [
    'scripts/lessons-ledger-gate.test.mjs',
    'apps/server/test/codeowners.test.ts',
    'integration/test/skills-routing-e2e.test.ts',
    'apps/daemon/test/local-executor.test.ts',
  ],
  'README.md': ['apps/daemon/test/workspace.test.ts'],
};
const grep = (doc) => index[doc] ?? [];

test('a doc change selects the tests that name it, split by runner', () => {
  assert.deepEqual(
    docReaderTests(['docs/ops/agent-bot-identity.md', 'docs/lessons.md', 'docs/unread.md'], grep, [
      'apps/daemon/test/local-executor.test.ts',
    ]),
    {
      node: ['scripts/lessons-ledger-gate.test.mjs'],
      vitest: ['apps/server/test/codeowners.test.ts'],
    },
  );
});

test('root-level doc names, integration suites and known-red files are not selected', () => {
  assert.deepEqual(docReaderTests(['README.md', 'AGENTS.md'], grep, []), { node: [], vitest: [] });
  assert.deepEqual(
    docReaderTests(['docs/lessons.md'], grep, ['apps/daemon/test/local-executor.test.ts']).vitest,
    ['apps/server/test/codeowners.test.ts'],
  );
});
