import assert from 'node:assert/strict';
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
    ),
    {
      node: ['scripts/agent-rules.test.mjs'],
      vitest: ['apps/server/test/codeowners.test.ts'],
    },
  );
});

test('root-level doc names, integration suites and locally-red files are not selected', () => {
  assert.deepEqual(docReaderTests(['README.md', 'AGENTS.md'], grep), { node: [], vitest: [] });
  assert.deepEqual(docReaderTests(['docs/lessons/README.md'], grep).vitest, [
    'apps/server/test/codeowners.test.ts',
  ]);
});

test('the retired collector archive is excluded while current identity safeguards remain selected', () => {
  assert.deepEqual(
    docReaderTests(['docs/ops/agent-bot-identity.md'], () => [
      'docs/research/assets/2136/review-check.test.mjs',
      'scripts/commit-identity.test.mjs',
      'apps/server/test/codeowners.test.ts',
    ]),
    {
      node: ['scripts/commit-identity.test.mjs'],
      vitest: ['apps/server/test/codeowners.test.ts'],
    },
  );
});

test('generated feature map and canon snapshots do not re-trigger generator self-tests', () => {
  const seen = [];
  const result = docReaderTests(
    ['docs/feature-map.md', '.claude/skills/verify-cairn/feature-map.md', 'docs/CANON.md'],
    (doc) => {
      seen.push(doc);
      return ['scripts/generate-feature-map.test.mjs'];
    },
    [],
  );
  assert.deepEqual(seen, []);
  assert.deepEqual(result, { node: [], vitest: [] });
});
