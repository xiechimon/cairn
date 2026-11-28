import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import {
  deadScopePrefixes,
  loadBlocks,
  parseRuleSection,
  selectBlocks,
} from './design-rules-for.mjs';

const run = (...args) =>
  execFileSync('node', ['scripts/design-rules-for.mjs', ...args], { encoding: 'utf8' });
const ids = (blocks) => blocks.flatMap((block) => block.rows.map((row) => row.id));

test('a Coordinator chat file gets the conversation, shared and process rows only', () => {
  const blocks = selectBlocks(['apps/web/src/chief/chief-question.tsx']);
  const got = ids(blocks);
  for (const id of ['P1', 'P7', 'V3', 'V33', 'T8', 'C14', 'C11', 'A3', 'R1', 'T1']) {
    assert.ok(got.includes(id), `${id} should apply to apps/web/src/chief/`);
  }
  for (const id of ['C20', 'C22', 'C48', 'L1', 'L9', 'C9', 'V26']) {
    assert.ok(!got.includes(id), `${id} should not apply to apps/web/src/chief/`);
  }
});

test('a settings file gets the settings rows and not the conversation ones', () => {
  const got = ids(selectBlocks(['apps/web/src/resources/providers-page.tsx']));
  for (const id of ['C20', 'C22', 'V5', 'T4', 'P3', 'P7', 'T8', 'V33']) {
    assert.ok(got.includes(id), `${id} missing`);
  }
  for (const id of ['C8', 'C14', 'C16', 'C48', 'L1', 'C9']) {
    assert.ok(!got.includes(id), `${id} leaked`);
  }
});

test('menu and overlay files get chrome rule C48', () => {
  for (const file of [
    'apps/web/src/components/menu-keys.tsx',
    'apps/web/src/board/sidebar-project-menu.tsx',
  ]) {
    const got = ids(selectBlocks([file]));
    assert.ok(got.includes('C48'), `C48 should apply to ${file}`);
  }
});

test('a sidebar file gets the L rows; a tray file gets V26', () => {
  const sidebar = ids(selectBlocks(['apps/web/src/board/sidebar.tsx']));
  assert.ok(sidebar.includes('L1') && sidebar.includes('L9'));
  assert.ok(!sidebar.includes('C14'));
  const tray = ids(selectBlocks(['apps/web/src/tray/tray-page.tsx']));
  assert.ok(tray.includes('V26'));
  assert.ok(!tray.includes('L1') && !tray.includes('C14'));
});

test('a file outside apps/web selects nothing', () => {
  assert.deepEqual(selectBlocks(['apps/daemon/src/runner.ts', 'packages/shared/src/index.ts']), []);
});

test('several paths union the matching files without duplicating rows', () => {
  const blocks = selectBlocks([
    'apps/web/src/chief/chief-root.tsx',
    'apps/web/src/board/sidebar.tsx',
  ]);
  const got = ids(blocks);
  assert.equal(new Set(got).size, got.length);
  assert.ok(got.includes('C14') && got.includes('L9'));
});

test('every Scope prefix is live and the CLI prints rows for a chief path', () => {
  assert.deepEqual(deadScopePrefixes(), []);
  const out = run('apps/web/src/chief/chief-question.tsx');
  assert.match(out, /C14/);
  assert.match(out, /V3/);
  assert.doesNotMatch(out, /\| C20 \||\| C22 \||\| L1 \|/);
  const empty = run('apps/daemon/src/runner.ts');
  assert.match(empty, /No design rules scoped to/);
});

test('the CLI prints the id index and resolves an id to its owning file', () => {
  assert.match(run('--ids'), /C14\tdocs\/design\/surfaces\/conversation\.md/);
  const out = run('C14');
  assert.match(out, /conversation\.md/);
  assert.match(out, /\| C14 \|/);
});

test('rule tables stay well-formed: one Scope line, ids unique, table headers present', () => {
  for (const block of loadBlocks()) {
    assert.ok(block.scope.length > 0, `${block.file} has a ## Rules section without a Scope line`);
    assert.ok(block.rows.length > 0, `${block.file} has an empty ## Rules table`);
  }
  const all = ids(loadBlocks());
  assert.equal(new Set(all).size, all.length, 'a rule id appears in two files');
});

test('parseRuleSection reads scope and rows', () => {
  const parsed = parseRuleSection(
    '# x\n\n## Rules\n\nScope: `apps/web/src/chief/` `apps/web/e2e/chief-`\n\n| Id | Rule | Check |\n|---|---|---|\n| C1 | r | M |\n\n## Other\n',
  );
  assert.deepEqual(parsed?.scope, ['apps/web/src/chief/', 'apps/web/e2e/chief-']);
  assert.deepEqual(
    parsed?.rows.map((row) => row.id),
    ['C1'],
  );
  assert.equal(parseRuleSection('# x\n\n## Other\n'), null);
});
