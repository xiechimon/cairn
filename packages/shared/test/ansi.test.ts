// ANSI/OSC8 转义剥离（#1262）：daemon 捕获的工具输出（biome 等带 SGR 颜色码
// + OSC8 超链接转义）原样落 build.errorMessage，板面几百行转义垃圾。失败方式
// 枚举先于实现固化（AGENTS.md 测试规则 3）：
//   F1 SGR 残留：彩色文本剥完仍带 `[0m` / `[38;5;231m` 形碎片（票面主诉）。
//   F2 OSC8 残留：超链接开/闭序列（`]8;;<url>` / `]8;;`）在输出里存活。
//   F3 OSC8 标签误吞：开/闭对之间的人类可读文本（规则名 lint/style/useTemplate）
//      被连序列一起剥掉——Multica sanitizeCLIOutput 的贪婪 `[^\x07]*` 分支正是
//      这个死法（codearts.go:801）；OSC 内容类必须排除 ESC 才停得在 ST 前。
//   F4 彩色开/关漂移：同一段 biome 诊断，彩色开与关两档输出剥后不一致
//      （票面验收 2）。
//   F5 BEL 终止形：`\x1b]8;;url\x07`（OSC 用 BEL 收尾）未被剥。
//   F6 过剥：无转义纯文本被改动 / 空串抛错。
//   F7 非幂等：二次剥离仍产生变化（残留或再吞）。
//   F8 非 SGR 的 CSI：`\x1b[2K`（擦行）等光标控制序列存活——SGR 只是 CSI 的
//      一个子集，工具输出里两者混排，按类剥。

import { describe, expect, test } from 'vitest';
import { stripAnsiEscapes } from '../src/ansi.js';

const ESC = '\x1b';

/** 实测污染样本（用户库 build.errorMessage 首行原文——整行 359,698 字符、
 * 75,458 个 ESC，全部由 SGR + OSC8 两族构成；此处取首行做代表）：剥后应得
 * 「前缀 + 文件:行:列 + 空格 + 规则名」。 */
const BIOME_ROW = `git commit failed (1): ${ESC}[0mapps/web/src/fixtures/fixtures.ts${ESC}[0m${ESC}[0m:${ESC}[0m${ESC}[0m1667${ESC}[0m${ESC}[0m:${ESC}[0m${ESC}[0m53${ESC}[0m${ESC}[0m ${ESC}[0m${ESC}[0m${ESC}]8;;https://biomejs.dev/linter/rules/use-template${ESC}\\lint/style/useTemplate${ESC}]8;;${ESC}\\${ESC}[0m${ESC}[0m ${ESC}[0m${ESC}[0m${ESC}[30m${ESC}[47m FIXABLE ${ESC}[0m${ESC}[0m ${ESC}[0m${ESC}[0m━━━━━━━━━━━━━━━━━━━━━━━━━${ESC}[0m${ESC}[0m`;

describe('stripAnsiEscapes（#1262）', () => {
  test('F1：SGR 全族剥净，正文保留', () => {
    expect(stripAnsiEscapes(`${ESC}[38;5;231m${ESC}[1mchecker${ESC}[0m failed`)).toBe(
      'checker failed',
    );
    expect(stripAnsiEscapes(`a${ESC}[0m`)).not.toContain('[0m');
  });

  test('F1：实测污染样本（BIOME_ROW）剥后无残留、首行可读', () => {
    const out = stripAnsiEscapes(BIOME_ROW);
    expect(out).toBe(
      'git commit failed (1): apps/web/src/fixtures/fixtures.ts:1667:53 lint/style/useTemplate  FIXABLE  ━━━━━━━━━━━━━━━━━━━━━━━━━',
    );
  });

  test('F2/F3：OSC8 ST 终止形——开闭对剥净、标签文本保留', () => {
    const linked = `${ESC}]8;;https://biomejs.dev/linter/rules/no-unused-imports${ESC}\\no-unused-imports${ESC}]8;;${ESC}\\`;
    expect(stripAnsiEscapes(linked)).toBe('no-unused-imports');
  });

  test('F5：OSC BEL 终止形（\\x07）同剥', () => {
    expect(stripAnsiEscapes(`${ESC}]8;;https://example.test${ESC}\\ok${ESC}]8;;\x07`)).toBe('ok');
    expect(stripAnsiEscapes(`${ESC}]0;window title\x07body`)).toBe('body');
  });

  test('F4：彩色开/关两档剥后一致（票面验收 2）', () => {
    const plain = 'checked 2 files in 3ms. fixable with biome check --fix';
    const colored = `${ESC}[0m${ESC}[2mchecked${ESC}[0m 2 files in 3ms. ${ESC}[1mfixable${ESC}[0m with ${ESC}]8;;https://biomejs.dev${ESC}\\biome check --fix${ESC}]8;;${ESC}\\`;
    expect(stripAnsiEscapes(colored)).toBe(stripAnsiEscapes(plain));
  });

  test('F8：非 SGR 的 CSI（擦行/光标）按类剥', () => {
    expect(stripAnsiEscapes(`${ESC}[2K${ESC}[1Gdone`)).toBe('done');
  });

  test('F6：纯文本不动、空串安全', () => {
    expect(stripAnsiEscapes('plain text, no escapes')).toBe('plain text, no escapes');
    expect(stripAnsiEscapes('')).toBe('');
    // 非法孤立 ESC（不属于 CSI/OSC）原样保留——剥离器不做修复，只剥已知类。
    expect(stripAnsiEscapes(`x${ESC}y`)).toBe(`x${ESC}y`);
  });

  test('F7：幂等', () => {
    const once = stripAnsiEscapes(BIOME_ROW);
    expect(stripAnsiEscapes(once)).toBe(once);
  });

  test('F3 反例钉死：Multica 贪婪 OSC 形的误吞我们的实现不犯', () => {
    // 开/闭对之间夹标签 + 后续正文，标签与正文都必须存活。
    const mixed = `hint: ${ESC}]8;;https://example.test/rule${ESC}\\the rule${ESC}]8;;${ESC}\\ applies`;
    expect(stripAnsiEscapes(mixed)).toBe('hint: the rule applies');
  });
});
