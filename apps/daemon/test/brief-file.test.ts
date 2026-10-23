// 简报落盘的失败方式（先列后写，仓规）——每一条对应下面一组用例：
// 1. 擦不干净 → 残留被下一步的 `git add -A` 扫进提交推到用户分支。故擦除的
//    逐字节回滚必须对用户文件的任意尾部形态都成立（0/1/2 个换行、CRLF）。
// 2. 重跑叠副本 → 同一 worktree 上第二次写入又追加一个块，文件无界增长，且
//    简报在上下文里出现两份。
// 3. 认错块 → 用户正文里本来就有的 END 串被当块尾，擦除时切掉用户的正文。
// 4. 崩溃半写 → BEGIN 在、END 不在，下次写入若在后面追加则残骸永久留存。
// 5. 误删用户文件 → 「创建态擦除」把用户本来就有的文件删了（判别位失效）。
// 6. 误碰 agent 产物 → 对账把无标记的未跟踪文件（agent 合法产出）当成残留清掉。
// 7. 遮蔽/隐形 → 落点判定错（见 shared 侧测试），这里钉端到端那一层。
// 8. 标记自污染 → 简报正文里含标记串，写出的文件以后定位不到真块。

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BRIEF_MARKER_BEGIN, BRIEF_MARKER_END } from '@cairn/shared';
import { afterEach, describe, expect, test } from 'vitest';
import {
  cleanupBriefFile,
  locateMarkerBlock,
  reconcileBriefLeftovers,
  writeBrief,
} from '../src/brief-file.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-brief-'));
  dirs.push(dir);
  return dir;
}

const CI = true; // darwin
const BRIEF = '# 简报\n\n任务文本。';

/** 块形与写入实现同构：BEGIN\n正文\nEND\n。 */
function blockOf(brief: string): string {
  return `${BRIEF_MARKER_BEGIN}\n${brief}\n${BRIEF_MARKER_END}\n`;
}

describe('writeBrief：三态写入', () => {
  test('空目录 → 新建，块在偏移 0，无前导分隔符（失败方式 5 的判别位）', () => {
    const cwd = freshDir();
    const h = writeBrief({ cwd, backendId: 'pi', content: BRIEF, caseInsensitiveFs: CI });
    expect(h.file).toBe('AGENTS.md');
    expect(h.mode).toBe('create');
    expect(readFileSync(h.path, 'utf8')).toBe(blockOf(BRIEF));
  });

  test('已有用户文件（无块）→ 追加「分隔符+块」，用户正文逐字保留', () => {
    const cwd = freshDir();
    writeFileSync(join(cwd, 'CLAUDE.md'), '用户的约定，没有尾换行');
    const h = writeBrief({ cwd, backendId: 'pi', content: BRIEF, caseInsensitiveFs: CI });
    expect(h.file).toBe('CLAUDE.md'); // 不新建 AGENTS.md（失败方式 7：遮蔽）
    expect(h.mode).toBe('append');
    expect(readFileSync(h.path, 'utf8')).toBe(`用户的约定，没有尾换行\n\n${blockOf(BRIEF)}`);
  });

  test('已有块 → 原地替换，不叠副本（失败方式 2）', () => {
    const cwd = freshDir();
    const first = writeBrief({ cwd, backendId: 'pi', content: '第一轮', caseInsensitiveFs: CI });
    const second = writeBrief({ cwd, backendId: 'pi', content: '第二轮', caseInsensitiveFs: CI });
    expect(second.path).toBe(first.path);
    const text = readFileSync(second.path, 'utf8');
    expect(text).toBe(blockOf('第二轮'));
    expect(text.split(BRIEF_MARKER_BEGIN).length - 1).toBe(1);
  });

  test('追加态上重跑：块仍只有一个，用户正文不动', () => {
    const cwd = freshDir();
    const userText = '用户正文\n';
    writeFileSync(join(cwd, 'CLAUDE.md'), userText);
    writeBrief({ cwd, backendId: 'pi', content: '第一轮', caseInsensitiveFs: CI });
    const h = writeBrief({ cwd, backendId: 'pi', content: '第二轮', caseInsensitiveFs: CI });
    // 追加恒定插入分隔符（不按用户尾字节做规范化），故用户正文以 1 个换行结尾时
    // 盘上出现 3 个换行——这是刻意的：分隔符宽度固定，擦除才能逐字节回滚。
    expect(readFileSync(h.path, 'utf8')).toBe(`${userText}\n\n${blockOf('第二轮')}`);
    expect(readFileSync(h.path, 'utf8').split(BRIEF_MARKER_BEGIN).length - 1).toBe(1);
  });

  test('大小写不敏感的盘上写入盘上真实拼写（失败方式 5 的变体）', () => {
    const cwd = freshDir();
    writeFileSync(join(cwd, 'CLAUDE.MD'), '用户正文');
    const h = writeBrief({ cwd, backendId: 'pi', content: BRIEF, caseInsensitiveFs: CI });
    expect(h.file).toBe('CLAUDE.MD');
    // 断言用 readdir 而非 existsSync：在本机（大小写不敏感）的盘上
    // existsSync('CLAUDE.md') 对 CLAUDE.MD 本来就为真，那个断言恒假。
    expect(readdirSync(cwd)).toEqual(['CLAUDE.MD']); // 没多造同名异写副本
  });

  test('正文含标记串 → 抛错，绝不写出擦不干净的文件（失败方式 8）', () => {
    const cwd = freshDir();
    expect(() =>
      writeBrief({
        cwd,
        backendId: 'pi',
        content: `${BRIEF_MARKER_BEGIN} 伪造`,
        caseInsensitiveFs: CI,
      }),
    ).toThrow(/must not contain the runtime markers/);
    expect(readdirSync(cwd)).toEqual([]); // 抛在写盘之前，目录仍干净
  });
});

describe('cleanupBriefFile：逐字节回滚', () => {
  const tails: [string, string][] = [
    ['无尾换行', '用户正文'],
    ['一个尾换行', '用户正文\n'],
    ['两个尾换行', '用户正文\n\n'],
    ['CRLF 正文', '用户正文\r\n'],
  ];
  for (const [label, userText] of tails) {
    test(`追加态擦除后与注入前逐字节相同（${label}）`, () => {
      const cwd = freshDir();
      const path = join(cwd, 'CLAUDE.md');
      writeFileSync(path, userText);
      writeBrief({ cwd, backendId: 'pi', content: BRIEF, caseInsensitiveFs: CI });
      expect(cleanupBriefFile(path)).toBe('excised');
      expect(readFileSync(path, 'utf8')).toBe(userText);
    });
  }

  test('创建态擦除 → 文件消失（连存在性一起回滚）', () => {
    const cwd = freshDir();
    const h = writeBrief({ cwd, backendId: 'pi', content: BRIEF, caseInsensitiveFs: CI });
    expect(cleanupBriefFile(h.path)).toBe('removed');
    expect(existsSync(h.path)).toBe(false);
  });

  test('幂等：已擦干净再来一次是 noop', () => {
    const cwd = freshDir();
    const h = writeBrief({ cwd, backendId: 'pi', content: BRIEF, caseInsensitiveFs: CI });
    expect(cleanupBriefFile(h.path)).toBe('removed');
    expect(cleanupBriefFile(h.path)).toBe('noop');
  });

  test('无块的文件不动（失败方式 5：不误删用户文件）', () => {
    const cwd = freshDir();
    const path = join(cwd, 'CLAUDE.md');
    writeFileSync(path, '用户的文件，没有我们的块\n');
    expect(cleanupBriefFile(path)).toBe('noop');
    expect(readFileSync(path, 'utf8')).toBe('用户的文件，没有我们的块\n');
  });

  test('用户正文里的游离 END 串不被当块（失败方式 3）', () => {
    const cwd = freshDir();
    const path = join(cwd, 'CLAUDE.md');
    const userText = `正文里提到 ${BRIEF_MARKER_END} 这个词\n`;
    writeFileSync(path, userText);
    // 无 BEGIN ⇒ 不是块；对账/擦除都不该动它。
    expect(cleanupBriefFile(path)).toBe('noop');
    expect(readFileSync(path, 'utf8')).toBe(userText);
  });
});

describe('locateMarkerBlock：畸形形态', () => {
  test('崩溃半写块（BEGIN 在、END 不在）→ 余下整段当块（失败方式 4）', () => {
    const text = `用户正文\n\n${BRIEF_MARKER_BEGIN}\n半写的内容没有收尾`;
    const span = locateMarkerBlock(text);
    expect(span).not.toBeNull();
    expect(span!.end).toBe(text.length);
  });

  test('半写残骸上的写入 → 整体替换，残骸不永久留存', () => {
    const cwd = freshDir();
    const path = join(cwd, 'AGENTS.md');
    writeFileSync(path, `用户正文\n\n${BRIEF_MARKER_BEGIN}\n半写残骸`);
    const h = writeBrief({ cwd, backendId: 'pi', content: '新一轮', caseInsensitiveFs: CI });
    expect(readFileSync(h.path, 'utf8')).toBe(`用户正文\n\n${blockOf('新一轮')}`);
  });

  test('吃掉块后那一个换行：连续两轮不累积空行', () => {
    const cwd = freshDir();
    writeFileSync(join(cwd, 'CLAUDE.md'), '用户正文');
    const h = writeBrief({ cwd, backendId: 'pi', content: 'A', caseInsensitiveFs: CI });
    writeBrief({ cwd, backendId: 'pi', content: 'B', caseInsensitiveFs: CI });
    expect(readFileSync(h.path, 'utf8')).toBe(`用户正文\n\n${blockOf('B')}`);
  });
});

describe('reconcileBriefLeftovers：崩溃残留对账', () => {
  test('残留的创建态文件被删、残留的追加块被剥、无标记产物绝不动（失败方式 6）', () => {
    const cwd = freshDir();
    // 残留 1：上一轮 pi 建的 AGENTS.md（创建态，块在 0）
    writeFileSync(join(cwd, 'AGENTS.md'), blockOf('上一轮的简报'));
    // 残留 2：更早某轮追加进 CLAUDE.md 的块
    writeFileSync(join(cwd, 'CLAUDE.md'), `用户正文\n\n${blockOf('更早的简报')}`);
    // 合法产物：agent 自己写的、无标记
    writeFileSync(join(cwd, 'NOTES.md'), 'agent 的产物\n');

    // 本轮目标 = AGENTS.md（pi first-wins），对账跳过它；CLAUDE.md 该被剥干净。
    const touched = reconcileBriefLeftovers(cwd, CI, 'AGENTS.md');
    expect(touched).toEqual(['CLAUDE.md']);
    expect(readFileSync(join(cwd, 'CLAUDE.md'), 'utf8')).toBe('用户正文');
    expect(readFileSync(join(cwd, 'NOTES.md'), 'utf8')).toBe('agent 的产物\n');
  });

  test('非目标候选里的创建态残留被删掉（跨后端复用 worktree 的形态）', () => {
    const cwd = freshDir();
    // 上一轮 pi 建的 AGENTS.md 残留；本轮 claude-code 目标 = CLAUDE.md。
    writeFileSync(join(cwd, 'AGENTS.md'), blockOf('上一轮 pi 的简报'));
    const touched = reconcileBriefLeftovers(cwd, CI, 'CLAUDE.md');
    expect(touched).toEqual(['AGENTS.md']);
    expect(existsSync(join(cwd, 'AGENTS.md'))).toBe(false);
  });

  test('无关文件一律不碰', () => {
    const cwd = freshDir();
    writeFileSync(join(cwd, 'README.md'), '# readme\n');
    writeFileSync(join(cwd, 'package.json'), '{}\n');
    expect(reconcileBriefLeftovers(cwd, CI, 'AGENTS.md')).toEqual([]);
    expect(readFileSync(join(cwd, 'README.md'), 'utf8')).toBe('# readme\n');
  });
});

describe('端到端：写入 → 擦除的完整周期', () => {
  test('pi 在有 CLAUDE.md 的仓库里：写进 CLAUDE.md，周期后逐字节回到原样', () => {
    const cwd = freshDir();
    const path = join(cwd, 'CLAUDE.md');
    const userText = '# 本仓库约定\n\n- 用 pnpm\n';
    writeFileSync(path, userText);
    const h = writeBrief({ cwd, backendId: 'pi', content: BRIEF, caseInsensitiveFs: CI });
    expect(h.file).toBe('CLAUDE.md');
    expect(readFileSync(path, 'utf8')).toContain('本仓库约定');
    cleanupBriefFile(h.path);
    expect(readFileSync(path, 'utf8')).toBe(userText);
  });

  test('claude-code 在只有 AGENTS.md 的仓库里：新建 CLAUDE.md，周期后干净不残留', () => {
    const cwd = freshDir();
    writeFileSync(join(cwd, 'AGENTS.md'), 'pi 形态的约定\n');
    const h = writeBrief({ cwd, backendId: 'claude-code', content: BRIEF, caseInsensitiveFs: CI });
    expect(h.file).toBe('CLAUDE.md');
    expect(h.mode).toBe('create');
    cleanupBriefFile(h.path);
    expect(existsSync(join(cwd, 'CLAUDE.md'))).toBe(false);
    expect(readFileSync(join(cwd, 'AGENTS.md'), 'utf8')).toBe('pi 形态的约定\n');
  });
});
