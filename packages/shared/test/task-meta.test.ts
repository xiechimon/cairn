import { describe, expect, it } from 'vitest';
import { derivePlaceholderTitle, FIXED_TAGS } from '../src/task-meta.js';

describe('derivePlaceholderTitle', () => {
  it('single-line input returned verbatim', () => {
    expect(derivePlaceholderTitle('给登录页加验证码')).toBe('给登录页加验证码');
  });

  it('multi-line input takes the first line', () => {
    expect(derivePlaceholderTitle('修支付回调\n\n现在的情况：偶尔掉单')).toBe('修支付回调');
  });

  it('skips leading blank lines to the first non-empty line', () => {
    expect(derivePlaceholderTitle('\n  \n修支付回调\n细节')).toBe('修支付回调');
  });

  it('first line trimmed of leading/trailing whitespace', () => {
    expect(derivePlaceholderTitle('  修支付回调  \n细节')).toBe('修支付回调');
  });

  it('exactly 50 chars: no truncation, no ellipsis', () => {
    const line = '一'.repeat(50);
    expect(derivePlaceholderTitle(line)).toBe(line);
  });

  it('51 chars truncate to 50 with an ellipsis appended', () => {
    const line = '一'.repeat(51);
    const result = derivePlaceholderTitle(line);
    expect(result).toBe(`${'一'.repeat(50)}…`);
    expect(result.length).toBe(51);
  });

  it('all-whitespace -> empty string (caller-side fallback copy)', () => {
    expect(derivePlaceholderTitle('')).toBe('');
    expect(derivePlaceholderTitle('   \n \n')).toBe('');
  });

  it('#757: when the first line is an attachment token line, the first body line after it is used (title surface shows no bare path)', () => {
    expect(
      derivePlaceholderTitle('![pasted-image-1.png](attachment:team-1/att-1.png)\n修复登录'),
    ).toBe('修复登录');
  });

  it('#757: body before token leaves the title unchanged', () => {
    expect(derivePlaceholderTitle('修复登录\n![a.png](attachment:t/i.png)')).toBe('修复登录');
  });

  it("#757: all-token lines take the first token's file name (chip name)", () => {
    expect(
      derivePlaceholderTitle('![a.png](attachment:t/i.png)\n![b.png](attachment:t/i2.png)'),
    ).toBe('a.png');
  });

  it('#757: token lines with empty label are skipped', () => {
    expect(derivePlaceholderTitle('![](attachment:t/i.png)\n修复登录')).toBe('修复登录');
  });

  it('#757: inline tokens keep only the file name', () => {
    expect(derivePlaceholderTitle('看这个 ![a.png](attachment:t/i.png) 很重要')).toBe(
      '看这个 a.png 很重要',
    );
  });

  it('#757: over-long file names truncated at 50 (same rule as body)', () => {
    const label = `${'a'.repeat(60)}.png`;
    const result = derivePlaceholderTitle(`![${label}](attachment:t/i.png)`);
    expect(result).toBe(`${label.slice(0, 50)}…`);
  });
});

describe('FIXED_TAGS', () => {
  it('fixed 6-item vocabulary', () => {
    expect(FIXED_TAGS.map((t) => t.name)).toEqual([
      'bug',
      'feature',
      'improvement',
      'refactor',
      'docs',
      'chore',
    ]);
  });

  it('name unique, color a valid hex, description non-empty', () => {
    const names = new Set(FIXED_TAGS.map((t) => t.name));
    expect(names.size).toBe(FIXED_TAGS.length);
    for (const tag of FIXED_TAGS) {
      expect(tag.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(tag.description.length).toBeGreaterThan(0);
    }
  });
});
