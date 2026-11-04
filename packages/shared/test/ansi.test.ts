import { describe, expect, test } from 'vitest';
import { stripAnsiEscapes } from '../src/ansi.js';

const ESC = '\x1b';

const BIOME_ROW = `git commit failed (1): ${ESC}[0mapps/web/src/fixtures/fixtures.ts${ESC}[0m${ESC}[0m:${ESC}[0m${ESC}[0m1667${ESC}[0m${ESC}[0m:${ESC}[0m${ESC}[0m53${ESC}[0m${ESC}[0m ${ESC}[0m${ESC}[0m${ESC}]8;;https://biomejs.dev/linter/rules/use-template${ESC}\\lint/style/useTemplate${ESC}]8;;${ESC}\\${ESC}[0m${ESC}[0m ${ESC}[0m${ESC}[0m${ESC}[30m${ESC}[47m FIXABLE ${ESC}[0m${ESC}[0m ${ESC}[0m${ESC}[0m━━━━━━━━━━━━━━━━━━━━━━━━━${ESC}[0m${ESC}[0m`;

describe('stripAnsiEscapes（#1262）', () => {
  test('F1: full SGR family stripped, body text preserved', () => {
    expect(stripAnsiEscapes(`${ESC}[38;5;231m${ESC}[1mchecker${ESC}[0m failed`)).toBe(
      'checker failed',
    );
    expect(stripAnsiEscapes(`a${ESC}[0m`)).not.toContain('[0m');
  });

  test('F1: measured polluted sample (BIOME_ROW) strips clean, first line readable', () => {
    const out = stripAnsiEscapes(BIOME_ROW);
    expect(out).toBe(
      'git commit failed (1): apps/web/src/fixtures/fixtures.ts:1667:53 lint/style/useTemplate  FIXABLE  ━━━━━━━━━━━━━━━━━━━━━━━━━',
    );
  });

  test('F2/F3: OSC8 ST-terminated form -- open/close pairs stripped, label text preserved', () => {
    const linked = `${ESC}]8;;https://biomejs.dev/linter/rules/no-unused-imports${ESC}\\no-unused-imports${ESC}]8;;${ESC}\\`;
    expect(stripAnsiEscapes(linked)).toBe('no-unused-imports');
  });

  test('F5: OSC BEL-terminated form (\\x07) also stripped', () => {
    expect(stripAnsiEscapes(`${ESC}]8;;https://example.test${ESC}\\ok${ESC}]8;;\x07`)).toBe('ok');
    expect(stripAnsiEscapes(`${ESC}]0;window title\x07body`)).toBe('body');
  });

  test('F4: colored on/off tiers strip identically (ticket acceptance 2)', () => {
    const plain = 'checked 2 files in 3ms. fixable with biome check --fix';
    const colored = `${ESC}[0m${ESC}[2mchecked${ESC}[0m 2 files in 3ms. ${ESC}[1mfixable${ESC}[0m with ${ESC}]8;;https://biomejs.dev${ESC}\\biome check --fix${ESC}]8;;${ESC}\\`;
    expect(stripAnsiEscapes(colored)).toBe(stripAnsiEscapes(plain));
  });

  test('F8: non-SGR CSI (erase line / cursor) stripped by class', () => {
    expect(stripAnsiEscapes(`${ESC}[2K${ESC}[1Gdone`)).toBe('done');
  });

  test('F6: plain text untouched, empty string safe', () => {
    expect(stripAnsiEscapes('plain text, no escapes')).toBe('plain text, no escapes');
    expect(stripAnsiEscapes('')).toBe('');
    expect(stripAnsiEscapes(`x${ESC}y`)).toBe(`x${ESC}y`);
  });

  test('F7: idempotent', () => {
    const once = stripAnsiEscapes(BIOME_ROW);
    expect(stripAnsiEscapes(once)).toBe(once);
  });

  test("F3 counterexample pinned: Multica's greedy OSC form swallows labels; our implementation does not", () => {
    const mixed = `hint: ${ESC}]8;;https://example.test/rule${ESC}\\the rule${ESC}]8;;${ESC}\\ applies`;
    expect(stripAnsiEscapes(mixed)).toBe('hint: the rule applies');
  });
});
