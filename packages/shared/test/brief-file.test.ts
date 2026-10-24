// 简报落点判定的失败方式（先列后写，仓规）——每一条都对应下面一组用例：
// 1. 遮蔽：仓库只有 CLAUDE.md，pi 却写 AGENTS.md → 引擎只读 AGENTS.md，用户
//    自己的仓库约定从上下文里消失，且**没有任何报错**。
// 2. 隐形：仓库有 AGENTS.override.md，写 AGENTS.md → 简报完全不被读。全搬之后
//    没有回退通道，等于这一步空转在一个零指令的会话里。
// 3. 大小写错判：macOS 的 existsSync('CLAUDE.md') 在盘上只有 CLAUDE.MD 时为真、
//    Linux 为假。判定与写入不同源 → 在用户已跟踪文件旁多造一个同名异写副本，
//    而「创建态擦除」会把这个副本删掉（或更糟：把用户的文件当自己建的删了）。
// 4. 后端错配：agent.provider 判成 pi 却写了 claude-code 要的文件（或反之）→
//    引擎读不到，同 2 的静默形态。
// 5. 覆盖写入目标：不是写盘上真实的那份，而是候选表里的拼写 → 大小写不敏感的
//    盘上看似新建，实际落到同一个 inode，于是「创建态擦除」把用户的文件删了。

import { describe, expect, test } from 'vitest';
import {
  BRIEF_BACKEND_IDS,
  BRIEF_CANDIDATES,
  BRIEF_CREATE_NAME,
  BRIEF_MANAGED_SEPARATOR,
  BRIEF_MARKER_BEGIN,
  BRIEF_MARKER_END,
  briefBackendForProvider,
  resolveBriefTarget,
} from '../src/brief-file.js';

const CI = { caseInsensitiveFs: true }; // darwin / win32
const CS = { caseInsensitiveFs: false }; // linux

describe('resolveBriefTarget：落点决策表（闸 2）', () => {
  test('空目录 → 各后端新建自己的标准名', () => {
    expect(resolveBriefTarget([], 'pi', CI)).toEqual({ file: 'AGENTS.md', mode: 'create' });
    expect(resolveBriefTarget([], 'claude-code', CI)).toEqual({
      file: 'CLAUDE.md',
      mode: 'create',
    });
  });

  test('只有 CLAUDE.md → pi 追加进它，绝不新建 AGENTS.md（失败方式 1：遮蔽）', () => {
    expect(resolveBriefTarget(['CLAUDE.md'], 'pi', CI)).toEqual({
      file: 'CLAUDE.md',
      mode: 'append',
    });
    expect(resolveBriefTarget(['CLAUDE.md'], 'claude-code', CI)).toEqual({
      file: 'CLAUDE.md',
      mode: 'append',
    });
  });

  test('只有 AGENTS.md → pi 追加进它；claude-code 新建 CLAUDE.md（SDK 不读 AGENTS.md）', () => {
    expect(resolveBriefTarget(['AGENTS.md'], 'pi', CI)).toEqual({
      file: 'AGENTS.md',
      mode: 'append',
    });
    expect(resolveBriefTarget(['AGENTS.md'], 'claude-code', CI)).toEqual({
      file: 'CLAUDE.md',
      mode: 'create',
    });
  });

  test('两者都在 → 各取自己序里先命中的那个', () => {
    expect(resolveBriefTarget(['CLAUDE.md', 'AGENTS.md'], 'pi', CI)).toEqual({
      file: 'AGENTS.md',
      mode: 'append',
    });
    expect(resolveBriefTarget(['CLAUDE.md', 'AGENTS.md'], 'claude-code', CI)).toEqual({
      file: 'CLAUDE.md',
      mode: 'append',
    });
  });

  test('AGENTS.override.md 压倒一切 → pi 必须写进它（失败方式 2：隐形）', () => {
    expect(resolveBriefTarget(['AGENTS.override.md'], 'pi', CI)).toEqual({
      file: 'AGENTS.override.md',
      mode: 'append',
    });
    expect(resolveBriefTarget(['AGENTS.override.md', 'AGENTS.md', 'CLAUDE.md'], 'pi', CI)).toEqual({
      file: 'AGENTS.override.md',
      mode: 'append',
    });
    // claude-code 不认 override 文件（pi 专属），照旧落 CLAUDE.md。
    expect(resolveBriefTarget(['AGENTS.override.md'], 'claude-code', CI)).toEqual({
      file: 'CLAUDE.md',
      mode: 'create',
    });
  });

  test('大小写不敏感的盘：CLAUDE.MD 满足 CLAUDE.md 候选，写入目标用盘上真实拼写（失败方式 3/5）', () => {
    expect(resolveBriefTarget(['CLAUDE.MD'], 'pi', CI)).toEqual({
      file: 'CLAUDE.MD',
      mode: 'append',
    });
    expect(resolveBriefTarget(['CLAUDE.MD'], 'claude-code', CI)).toEqual({
      file: 'CLAUDE.MD',
      mode: 'append',
    });
    expect(resolveBriefTarget(['agents.MD'], 'pi', CI)).toEqual({
      file: 'agents.MD',
      mode: 'append',
    });
  });

  test('大小写敏感的盘：CLAUDE.MD 仍被 pi 的第 5 个候选命中，但 claude-code 另建 CLAUDE.md', () => {
    // pi 的候选表里 CLAUDE.MD 是独立一项，故在 Linux 上也能命中。
    expect(resolveBriefTarget(['CLAUDE.MD'], 'pi', CS)).toEqual({
      file: 'CLAUDE.MD',
      mode: 'append',
    });
    // claude-code 只认 CLAUDE.md 这一种拼写 —— 盘上那份它本来就读不到，
    // 所以新建 CLAUDE.md 不构成遮蔽，反而是唯一能让简报被读到的方式。
    expect(resolveBriefTarget(['CLAUDE.MD'], 'claude-code', CS)).toEqual({
      file: 'CLAUDE.md',
      mode: 'create',
    });
  });

  test('大小写敏感的盘：全小写 claude.md 两边都不命中 → pi 新建 AGENTS.md（简报必须可见）', () => {
    expect(resolveBriefTarget(['claude.md'], 'pi', CS)).toEqual({
      file: 'AGENTS.md',
      mode: 'create',
    });
    expect(resolveBriefTarget(['claude.md'], 'claude-code', CS)).toEqual({
      file: 'CLAUDE.md',
      mode: 'create',
    });
  });

  test('无关文件不干扰判定', () => {
    const entries = ['README.md', 'package.json', 'src', '.git'];
    expect(resolveBriefTarget(entries, 'pi', CI)).toEqual({ file: 'AGENTS.md', mode: 'create' });
    expect(resolveBriefTarget(entries, 'claude-code', CS)).toEqual({
      file: 'CLAUDE.md',
      mode: 'create',
    });
  });
});

describe('briefBackendForProvider：与 runner backendFor 同源（失败方式 4）', () => {
  test('runtime 身份词表 → 对应后端；其余一律 pi', () => {
    expect(briefBackendForProvider('claude-code')).toBe('claude-code');
    expect(briefBackendForProvider('gemini')).toBe('gemini');
    expect(briefBackendForProvider('pi')).toBe('pi');
    expect(briefBackendForProvider('stub-gw')).toBe('pi'); // custom provider id
    expect(briefBackendForProvider(null)).toBe('pi');
    expect(briefBackendForProvider(undefined)).toBe('pi');
  });

  test('gemini 简报使用 GEMINI.md', () => {
    expect(resolveBriefTarget([], 'gemini', CI)).toEqual({ file: 'GEMINI.md', mode: 'create' });
  });
});

describe('词表自身的形状约束', () => {
  test('每个后端都有候选序与新建名，且新建名在候选序里', () => {
    for (const backend of BRIEF_BACKEND_IDS) {
      expect(BRIEF_CANDIDATES[backend].length).toBeGreaterThan(0);
      expect(BRIEF_CANDIDATES[backend]).toContain(BRIEF_CREATE_NAME[backend]);
    }
  });

  test('标记串是 HTML 注释（渲染器里惰性）且不成对出现在同一串里', () => {
    expect(BRIEF_MARKER_BEGIN.startsWith('<!--')).toBe(true);
    expect(BRIEF_MARKER_BEGIN.endsWith('-->')).toBe(true);
    expect(BRIEF_MARKER_END.startsWith('<!--')).toBe(true);
    expect(BRIEF_MARKER_END.endsWith('-->')).toBe(true);
    expect(BRIEF_MARKER_BEGIN).not.toBe(BRIEF_MARKER_END);
    // 托管分隔符非空 —— 空串会让「创建 vs 追加」的判别位失效。
    expect(BRIEF_MANAGED_SEPARATOR.length).toBeGreaterThan(0);
  });
});
