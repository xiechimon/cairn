import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { checkClaims } from './claim-proof-gate.mjs';
import { prepushPlan } from './prepush.mjs';
import { makeTestTempDir, releaseTestTempDir } from './test-tmpdir.mjs';

const root = resolve(import.meta.dirname, '..');
const fixtures = [];

function fixture(overrides = {}) {
  const dir = makeTestTempDir('claim-proof-gate');
  fixtures.push(dir);
  const files = {
    'README.md': [
      '## What you get',
      '',
      '- **It remembers your corrections.** Memory comes back. <!-- claim: memory -->',
      '',
    ].join('\n'),
    'README.zh.md': [
      '## 你会得到什么',
      '',
      '- **记住你纠正过的事。** 记忆会被带回来。 <!-- claim: memory -->',
      '',
    ].join('\n'),
    'docs/spec/18-positioning-and-differentiation.md': [
      'what you correct becomes memory <!-- claim: memory -->',
      '',
      '### 1.1 Capabilities carried over from the 2026-11-01 thesis',
      '',
      '> 1. **It remembers corrections.** Text. <!-- claim: memory -->',
      '',
    ].join('\n'),
    'site/src/components/copy.ts': [
      '    points: {',
      '      items: [',
      '        {',
      "          title: 'Remembers what you correct',",
      "          claim: 'memory',",
      "          body: 'Memory comes back.',",
      '        },',
      '      ],',
      '    },',
      '',
    ].join('\n'),
    'docs/claims.json': JSON.stringify(
      {
        claims: [
          {
            id: 'memory',
            anchors: [
              { file: 'README.md', text: 'It remembers your corrections.' },
              { file: 'README.zh.md', text: '记住你纠正过的事。' },
              { file: 'site/src/components/copy.ts', text: 'Remembers what you correct' },
              {
                file: 'docs/spec/18-positioning-and-differentiation.md',
                text: 'what you correct becomes memory',
              },
            ],
            proof: ['feature:memory', 'apps/server/src/services/memory-documents.ts'],
          },
        ],
      },
      null,
      2,
    ),
    '.claude/skills/verify-cairn/feature-map.json': JSON.stringify({
      features: [{ id: 'memory', name: 'Memory' }],
    }),
    'apps/server/src/services/memory-documents.ts': 'export {};\n',
  };
  for (const [path, content] of Object.entries({ ...files, ...overrides })) {
    const full = join(dir, path);
    mkdirSync(resolve(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

function claimsOf(claims) {
  return { 'docs/claims.json': JSON.stringify({ claims }, null, 2) };
}

test('passes on the real tree', () => {
  assert.deepEqual(checkClaims({ cwd: root }), []);
});

test('passes on a whole fixture', () => {
  assert.deepEqual(checkClaims({ cwd: fixture() }), []);
});

test('fails when a stale claim comes back without a marker', () => {
  const dir = fixture({
    'README.md': [
      '## What you get',
      '',
      '- **Reports both lists.** Every report ends with *Decided myself*, each choice with its reason, and *Needs your decision*: at most three items, each with options, evidence and a recommendation.',
      '',
    ].join('\n'),
  });
  assert.match(
    checkClaims({ cwd: dir }).join('\n'),
    /README\.md:3: claim line carries no proof marker/,
  );
});

test('fails when a proof target no longer resolves', () => {
  const dir = fixture(
    claimsOf([
      {
        id: 'memory',
        anchors: [{ file: 'README.md', text: 'It remembers your corrections.' }],
        proof: ['feature:memory', 'apps/server/src/services/gone.ts'],
      },
    ]),
  );
  assert.match(
    checkClaims({ cwd: dir }).join('\n'),
    /claim memory: pointer does not resolve: apps\/server\/src\/services\/gone\.ts/,
  );
});

test('fails when a feature id is unknown', () => {
  const dir = fixture(
    claimsOf([
      {
        id: 'memory',
        anchors: [{ file: 'README.md', text: 'It remembers your corrections.' }],
        proof: ['feature:not-a-feature'],
      },
    ]),
  );
  assert.match(checkClaims({ cwd: dir }).join('\n'), /unknown feature not-a-feature/);
});

test('fails when a marker names an unregistered claim', () => {
  const dir = fixture({
    'README.md': [
      '## What you get',
      '',
      '- **It remembers your corrections.** Memory comes back. <!-- claim: memory -->',
      '- **Ship gates.** Danger. <!-- claim: ship-gate -->',
      '',
    ].join('\n'),
  });
  assert.match(checkClaims({ cwd: dir }).join('\n'), /unknown claim ship-gate/);
});

test('fails when a claim sentence has been edited away', () => {
  const dir = fixture({
    'README.md': [
      '## What you get',
      '',
      '- **Something else.** Text. <!-- claim: memory -->',
      '',
    ].join('\n'),
  });
  assert.match(checkClaims({ cwd: dir }).join('\n'), /anchor for memory is gone/);
});

test('fails when a registry entry carries no proof', () => {
  const dir = fixture(
    claimsOf([
      {
        id: 'memory',
        anchors: [{ file: 'README.md', text: 'It remembers your corrections.' }],
        proof: [],
      },
    ]),
  );
  assert.match(checkClaims({ cwd: dir }).join('\n'), /claim memory carries no proof pointer/);
});

test('fails when a home point item loses its claim key', () => {
  const dir = fixture({
    'site/src/components/copy.ts': [
      '    points: {',
      '      items: [',
      '        {',
      "          title: 'No pointer',",
      "          body: 'Text.',",
      '        },',
      '      ],',
      '    },',
      '',
    ].join('\n'),
  });
  assert.match(
    checkClaims({ cwd: dir }).join('\n'),
    /copy\.ts:3: home point item #1 carries no claim/,
  );
});

test('names the locale and item index when a home point loses its claim', () => {
  const dir = fixture({
    'site/src/components/copy.ts': [
      'export const copy = {',
      '  zh: {',
      '    points: {',
      '      items: [',
      '        {',
      "          title: '无指针',",
      "          body: 'Text.',",
      '        },',
      '      ],',
      '    },',
      '  },',
      '};',
      '',
    ].join('\n'),
  });
  assert.match(
    checkClaims({ cwd: dir }).join('\n'),
    /copy\.ts:5: zh home point item #1 carries no claim/,
  );
});

test('fails when the covered README section disappears', () => {
  const dir = fixture({ 'README.md': ['# Cairn', '', 'text', ''].join('\n') });
  assert.match(checkClaims({ cwd: dir }).join('\n'), /heading "## What you get" is missing/);
});

test('stays quiet on a tree that never adopted claims', () => {
  const dir = makeTestTempDir('claim-proof-empty');
  fixtures.push(dir);
  writeFileSync(join(dir, 'README.md'), '# Cairn\n\nA plain readme.\n');
  assert.deepEqual(checkClaims({ cwd: dir }), []);
});

test('fails when markers exist but the registry is gone', () => {
  const dir = makeTestTempDir('claim-proof-orphan');
  fixtures.push(dir);
  writeFileSync(
    join(dir, 'README.md'),
    ['## What you get', '', '- **Memory.** Text. <!-- claim: memory -->', ''].join('\n'),
  );
  assert.match(
    checkClaims({ cwd: dir }).join('\n'),
    /README\.md:3: claim markers exist but docs\/claims\.json is missing/,
  );
});

test('fails when the registry is deleted but a home point keeps its claim key', () => {
  const dir = fixture();
  rmSync(join(dir, 'docs/claims.json'));
  assert.match(
    checkClaims({ cwd: dir }).join('\n'),
    /copy\.ts:3: home point item #1 keeps claim 'memory' but docs\/claims\.json is missing/,
  );
});

test('fails when spec 18 gains an unmarked capability item', () => {
  const dir = fixture({
    'docs/spec/18-positioning-and-differentiation.md': [
      'what you correct becomes memory <!-- claim: memory -->',
      '',
      '### 1.1 Capabilities carried over from the 2026-11-01 thesis',
      '',
      '> 1. **An evidence-bound merge gate, model-checked.** Text.',
      '',
    ].join('\n'),
  });
  assert.match(
    checkClaims({ cwd: dir }).join('\n'),
    /docs\/spec\/18-positioning-and-differentiation\.md:5: claim line carries no proof marker/,
  );
});

test('is wired into both prepush plans', () => {
  for (const mode of ['ci', 'local']) {
    const steps = prepushPlan(['README.md'], mode).map((step) => step.join(' '));
    assert.ok(
      steps.includes('node scripts/claim-proof-gate.mjs'),
      `${mode} plan runs the gate: ${steps.join(' | ')}`,
    );
  }
});

test.after(() => {
  while (fixtures.length > 0) releaseTestTempDir(fixtures.pop());
});
