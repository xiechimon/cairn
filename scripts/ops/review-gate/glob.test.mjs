import assert from 'node:assert/strict';
import { test } from 'node:test';
import { globToRegExp } from './owner-routing.mjs';

const cases = [
  ['.github/**', '.github/workflows/site-deploy.yml', true],
  ['.github/**', '.github/x.yml', true],
  ['docs/lessons/**', 'docs/lessons/2026/a.md', true],
  ['**/.claude/**', 'apps/web/.claude/skills/x/SKILL.md', true],
  ['**/scripts/**', 'scripts/prepush.mjs', true],
  ['**/*.config.*', 'apps/web/vite.config.ts', true],
  ['**/*.config.*', 'apps/web/src/config.ts', false],
  ['docs/adr/**', 'docs/spec/x.md', false],
];
for (const [glob, path, expected] of cases) {
  test(`${glob} matches ${path}: ${expected}`, () => {
    assert.equal(globToRegExp(glob, { protect: true }).test(path), expected);
  });
}
