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
//   13. 净化后 slug 超过 200 → 截到 200 再加路径哈希。CLI 2.1.278 在
//       250 字符 cwd 上落盘目录以 `-ebpasi` 结尾，与本式一致。不截断时
//       长路径预检仍 miss，降级会把还能续上的会话当成丢失。
//   14. `CLAUDE_CONFIG_DIR` 有值且 `CLAUDE_CODE_PROJECT_DIR_NAME` 合法时，
//       目录名用该覆写，根目录改到配置目录。非法名（含 `.`、Windows 设备名）
//       不覆写 slug。未设配置目录时目录名环境变量不生效。

import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { sdkTranscriptPath } from '../src/backend/claude-code.js';

/** CLI 2.1.278 `hm`：净化后不超过 200 原样返回，否则截断并附
 *  `Math.abs(int32 djb-like hash).toString(36)`。哈希输入是净化前的路径。 */
function cliProjectSlug(resolved: string): string {
  const flat = resolved.replace(/[^a-zA-Z0-9]/g, '-');
  if (flat.length <= 200) return flat;
  let hash = 0;
  for (let i = 0; i < resolved.length; i++) {
    hash = ((hash << 5) - hash + resolved.charCodeAt(i)) | 0;
  }
  return `${flat.slice(0, 200)}-${Math.abs(hash).toString(36)}`;
}

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

  test('失败方式 13：净化后超过 200 的 cwd 截断并附路径哈希', () => {
    const parent = mkdtempSync(join(tmpdir(), 'pacman-cc-long-'));
    const cwd = join(parent, 'p'.repeat(220));
    mkdirSync(cwd);
    const resolved = realpathSync(cwd);
    const flat = resolved.replace(/[^a-zA-Z0-9]/g, '-');
    const sessionId = 'sess-long';
    expect(flat.length).toBeGreaterThan(200);
    const slug = cliProjectSlug(resolved);
    expect(slug.length).toBeLessThan(flat.length);
    expect(sdkTranscriptPath(cwd, sessionId)).toBe(
      join(homedir(), '.claude', 'projects', slug, `${sessionId}.jsonl`),
    );
  });

  test('失败方式 14：配置目录覆写合法项目名，非法名与缺配置目录不覆写', () => {
    const parent = mkdtempSync(join(tmpdir(), 'pacman-cc-over-'));
    const cwd = join(parent, 'dot.hidden_dir');
    mkdirSync(cwd);
    const resolved = realpathSync(cwd);
    const sessionId = 'sess-over';
    const configDir = join(parent, 'claude-config');
    const prevConfig = process.env.CLAUDE_CONFIG_DIR;
    const prevName = process.env.CLAUDE_CODE_PROJECT_DIR_NAME;
    try {
      process.env.CLAUDE_CONFIG_DIR = configDir;
      process.env.CLAUDE_CODE_PROJECT_DIR_NAME = 'resume_ok-1';
      expect(sdkTranscriptPath(cwd, sessionId)).toBe(
        join(configDir.normalize('NFC'), 'projects', 'resume_ok-1', `${sessionId}.jsonl`),
      );

      process.env.CLAUDE_CODE_PROJECT_DIR_NAME = 'bad.name';
      expect(sdkTranscriptPath(cwd, sessionId)).toBe(
        join(
          configDir.normalize('NFC'),
          'projects',
          cliProjectSlug(resolved),
          `${sessionId}.jsonl`,
        ),
      );

      process.env.CLAUDE_CODE_PROJECT_DIR_NAME = 'CON';
      expect(sdkTranscriptPath(cwd, sessionId)).toBe(
        join(
          configDir.normalize('NFC'),
          'projects',
          cliProjectSlug(resolved),
          `${sessionId}.jsonl`,
        ),
      );

      delete process.env.CLAUDE_CONFIG_DIR;
      process.env.CLAUDE_CODE_PROJECT_DIR_NAME = 'resume_ok-1';
      expect(sdkTranscriptPath(cwd, sessionId)).toBe(
        join(homedir(), '.claude', 'projects', cliProjectSlug(resolved), `${sessionId}.jsonl`),
      );
    } finally {
      if (prevConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = prevConfig;
      if (prevName === undefined) delete process.env.CLAUDE_CODE_PROJECT_DIR_NAME;
      else process.env.CLAUDE_CODE_PROJECT_DIR_NAME = prevName;
    }
  });
});
