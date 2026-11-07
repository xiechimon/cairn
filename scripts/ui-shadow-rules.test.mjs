import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shadowFindings } from './ui-shadow-rules.mjs';

test('G8 rejects state shadows and explicit box-shadow transitions', () => {
  for (const utility of [
    'hover:shadow-sm',
    'dark:hover:shadow-(--e1)',
    'active:shadow-none',
    'hover:drop-shadow-lg',
    'group-hover:shadow-lg',
    'transition-shadow',
    'transition-[color,box-shadow]',
    '[transition:box-shadow_150ms]',
  ]) {
    assert.equal(shadowFindings(`<div className="${utility}" />`).length, 1, utility);
  }
  for (const declaration of [
    'transition: box-shadow 150ms;',
    'transition:\n  color 100ms,\n  box-shadow 150ms;',
    'transition-property: color, box-shadow;',
    'transition: all 150ms;',
    "style={{ transition: 'box-shadow 150ms' }}",
  ])
    assert.equal(shadowFindings(declaration).length, 1, declaration);
});

test('G8 preserves static elevation and focus outlines and ignores comments', () => {
  assert.deepEqual(
    shadowFindings('<div className="shadow-(--e1) focus-visible:outline-2 transition-colors" />'),
    [],
  );
  assert.deepEqual(shadowFindings('/* hover:shadow-lg */'), []);
});

test('G8 annotations require a reason and apply only to the next source line', () => {
  assert.deepEqual(
    shadowFindings(
      '{/* deliberate-shadow: overlay demo showing the elevation scale */}\n<div className="hover:shadow-lg" />',
    ),
    [],
  );
  assert.equal(
    shadowFindings('{/* deliberate-shadow: */}\n<div className="hover:shadow-lg" />').length,
    1,
  );
  assert.equal(
    shadowFindings(
      '// deliberate-shadow: overlay demo\nconst unrelated = 1;\n<div className="hover:shadow-lg" />',
    ).length,
    1,
  );
});

test('G8 reports source line numbers and does not confuse selected tabs with presses', () => {
  assert.deepEqual(
    shadowFindings('const x = 1;\n<div className="hover:shadow-xs" />').map((hit) => hit.line),
    [2],
  );
  assert.deepEqual(shadowFindings('<div className="data-active:shadow-xs" />'), []);
});
