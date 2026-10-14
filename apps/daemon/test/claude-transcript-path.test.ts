// resume 预检的 transcript 路径解析（spec 17 A7，#622 失败方式 10）：
// CLI 子进程 spawn cwd 经内核符号链接解析（macOS /tmp → /private/tmp），
// transcript slug 按解析后 cwd 计——预检若用未解析路径，/tmp 起头的工作区
// 恒 miss → SessionNotResumableError → resume 永远回退冷启（verify 622
// 实跑撞过：build 步 sessionId 与 plan 步分叉）。
// 失败方式枚举先于实现固化（AGENTS.md 测试规则 3）：
//   10. 符号链接 cwd → slug 解析到真实路径（与直连路径同串）
//   11. cwd 缺失 → 不抛（原路径判 miss，resume 走冷重试通道）
//   12. cwd 含 `.` / `_` 等非字母数字 → slug 与 CLI 2.1.278 同规则
//       （`/[^a-zA-Z0-9]/g` → `-`）。只替换 `/` 时 `~/.pacman` 工作区
//       预检恒 miss（#1312）。

import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { sdkTranscriptPath } from '../src/backend/claude-code.js';

describe('sdkTranscriptPath 路径解析（A7 resume 预检）', () => {
  test('失败方式 10：符号链接 cwd 的 slug = 真实路径的 slug', () => {
    const real = mkdtempSync(join(tmpdir(), 'pacman-cc-path-'));
    const link = join(tmpdir(), `pacman-cc-link-${randomUUID()}`);
    symlinkSync(real, link);
    const throughLink = sdkTranscriptPath(link, 'sess-1');
    const direct = sdkTranscriptPath(real, 'sess-1');
    expect(throughLink).toBe(direct);
    expect(sdkTranscriptPath(link, 'sess-1')).toContain('sess-1.jsonl');
  });

  test('失败方式 11：cwd 缺失不抛（原样拼路径，由存在性判 miss）', () => {
    expect(() =>
      sdkTranscriptPath(join(tmpdir(), `no-such-${randomUUID()}`), 'sess-1'),
    ).not.toThrow();
  });

  test('失败方式 12：非字母数字 cwd 字符按 CLI 规则换成 -', () => {
    const parent = mkdtempSync(join(tmpdir(), 'pacman-cc-slug-'));
    const cwd = join(parent, 'dot.hidden_dir');
    mkdirSync(cwd);
    const resolved = realpathSync(cwd);
    const sessionId = 'sess-slug';
    const slug = resolved.replace(/[^a-zA-Z0-9]/g, '-');
    const slashOnly = resolved.replaceAll('/', '-');
    expect(slug).not.toBe(slashOnly);
    expect(sdkTranscriptPath(cwd, sessionId)).toBe(
      join(homedir(), '.claude', 'projects', slug, `${sessionId}.jsonl`),
    );
  });
});
