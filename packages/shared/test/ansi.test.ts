import { describe, expect, it } from 'vitest';

import { stripAnsiEscapes } from '../src/ansi.js';

const ESC = '\u001b';
const BEL = '\u0007';

describe('stripAnsiEscapes', () => {
  it('剥 SGR 红/重置，正文保留', () => {
    expect(stripAnsiEscapes(`${ESC}[31merror text${ESC}[0m`)).toBe('error text');
    expect(
      stripAnsiEscapes(`${ESC}[1m${ESC}[38;2;255;0;0mfile.ts:1:1 lint/suspicious${ESC}[0m`),
    ).toBe('file.ts:1:1 lint/suspicious');
  });

  it('剥 OSC8 超链接——ST 与 BEL 两种终止符', () => {
    const st = `${ESC}]8;;https://example.com${ESC}\\link text${ESC}]8;;${ESC}\\`;
    expect(stripAnsiEscapes(st)).toBe('link text');
    const bel = `${ESC}]8;;https://example.com${BEL}link text${ESC}]8;;${BEL}`;
    expect(stripAnsiEscapes(bel)).toBe('link text');
  });

  it('剥 CSI 光标/擦除类序列', () => {
    expect(stripAnsiEscapes(`${ESC}[2K${ESC}[1Gdone${ESC}[?25h`)).toBe('done');
  });

  it('SGR + OSC8 嵌套混合', () => {
    const mixed = `${ESC}]8;;https://biomejs.dev${ESC}\\${ESC}[31mfile.ts:3:5 lint/a11y${ESC}[0m${ESC}]8;;${ESC}\\`;
    expect(stripAnsiEscapes(mixed)).toBe('file.ts:3:5 lint/a11y');
  });

  it('剥两字节 ESC 序列（如 ESC ( K）', () => {
    expect(stripAnsiEscapes(`${ESC}(Ktext`)).toBe('text');
  });

  it('截断序列剩的孤儿 ESC 字节也清掉', () => {
    expect(stripAnsiEscapes(`text${ESC}`)).toBe('text');
    expect(stripAnsiEscapes(`a${ESC}b`)).toBe('ab');
  });

  it('纯文本直通，逐字节不变', () => {
    const plain = 'src/app.ts:42:5 lint/noExplicitAny\n多行\n保留 · 原样';
    expect(stripAnsiEscapes(plain)).toBe(plain);
  });

  it('剥后不含 ESC 字节', () => {
    const samples = [
      `${ESC}[31mx${ESC}[0m`,
      `${ESC}]8;;https://x${ESC}\\y${ESC}]8;;${ESC}\\`,
      `${ESC}]8;;https://x${BEL}y${ESC}]8;;${BEL}`,
      `孤儿${ESC}`,
    ];
    for (const s of samples) {
      expect(stripAnsiEscapes(s)).not.toContain(ESC);
    }
  });

  it('幂等：剥过的输入再剥不变', () => {
    const once = stripAnsiEscapes(`${ESC}[31mx${ESC}[0m${ESC}]8;;u${ESC}\\y${ESC}]8;;${ESC}\\`);
    expect(stripAnsiEscapes(once)).toBe(once);
  });
});
