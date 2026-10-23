// claude 二进制探测（#1050）：`claude --version` + PATH 解析 → 「这台机器
// 装没装、装的在哪、什么版本」的事实源。
//
// 为什么需要它：providers 页 claude-code 段的 `installed` 原来的定义只等于
// 「~/.claude/settings.json 在且能解析」（claude-code-models.ts），与二进制
// 无关——配置文件在而二进制缺失/太旧时页面照样说「已安装」；反过来
// 「二进制在、能用、只是没写配置」显示成「未安装」。两个方向都摆正。
//
// 解析出的路径另有第二个消费点：SDK 的 `pathToClaudeCodeExecutable`
// （`@anthropic-ai/claude-agent-sdk` Options）。此前 `CAIRN_CLAUDE_BIN` 只喂
// auth 探针、SDK 侧不认——「探的二进制」与「执行的二进制」可能不是一个。
// 单源之后两边同值。
//
// 成本：本机实测 95ms（`claude --version`），presence 30s 一节拍，占空比 ~0.3%。

import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';

/** 探测结果。`version: null` = 二进制在但输出里没有版本号（wrapper 打了
 *  别的东西）——路径本身就足以判定「装了」，版本只是信息位。 */
export interface ClaudeBinInfo {
  path: string;
  version: string | null;
  /** 命中来源（#1290）：'PATH' = 显式路径或 PATH 扫描；'well-known' = PATH
   *  探空后的 well-known 目录回落（launchd 窄 PATH 场景）。注入 run 面跳过
   *  解析，此字段缺位。 */
  source?: 'PATH' | 'well-known';
}

/** 探针执行的注入面（测试免发真 CLI，同 claude-code-auth 之律）。 */
export type ClaudeBinRun = (
  command: string,
  args: readonly string[],
  opts: { timeoutMs: number },
) => Promise<{ stdout: string }>;

export interface ClaudeBinProbeOpts {
  /** `claude` 可执行文件（缺省 `CAIRN_CLAUDE_BIN` ?? 'claude'；裸名走 PATH）。 */
  command?: string;
  /** 2s 上界：version 实测 95ms，5s 那个值是给 `claude auth status` 的；
   *  presence 节拍不许被一个挂住的子进程拖住。 */
  timeoutMs?: number;
  run?: ClaudeBinRun;
  /** PATH 面（缺省 process.env；测试注入隔离 PATH）。 */
  env?: { PATH?: string; HOME?: string };
  /** well-known 回落目录面（缺省 homebrew 两槽 + ~/.local/bin；测试注入
   *  隔离目录，免真机 /opt/homebrew/bin 有真 claude 时测试变得不确定）。 */
  wellKnownDirs?: readonly string[];
}

const DEFAULT_TIMEOUT_MS = 2_000;

/** 版本号词法：`\d+.\d+.\d+` 起头，允许预发布/构建后缀（2.1.289-beta.3）。
 *  取**第一个**命中——CLI 实测输出形 `2.1.289 (Claude Code)`，wrapper 可能
 *  在前面打别的行。 */
const VERSION_PATTERN = /\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/;

/** `claude --version` stdout → 版本号（无版本号 → null）。纯函数。 */
export function parseClaudeVersion(stdout: string): string | null {
  const match = VERSION_PATTERN.exec(stdout);
  return match ? match[0] : null;
}

function isExecutable(p: string): boolean {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** 命令名 → 绝对路径（Go `exec.LookPath` 语义）：带路径分隔符的按 cwd 相对
 *  处理（绝对路径直接用），裸名扫 PATH；两条路都要求「存在 + 可执行位」——
 *  显式路径不校验等于把假绿原样搬进新字段。解析不到 → null。 */
export function resolveCommandPath(
  command: string,
  env: { PATH?: string } = process.env,
): string | null {
  if (isAbsolute(command) || command.includes('/')) {
    return isExecutable(command) ? command : null;
  }
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (dir === '') continue;
    const candidate = join(dir, command);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

/** #1290：launchd 环境 PATH 窄（plist 模板历史上只有 @NODE_DIR@ 与系统
 *  四槽），homebrew 装的 claude 探不到——PATH 探空后对裸命令名回落扫
 *  well-known 目录：homebrew arm64 / intel 两槽 + 安装脚本常用的
 *  ~/.local/bin。只回落裸名——显式路径的判定（存在 + 执行位）不变。 */
export function wellKnownClaudeBinDirs(env: { HOME?: string } = process.env): string[] {
  return ['/opt/homebrew/bin', '/usr/local/bin', join(env.HOME ?? homedir(), '.local/bin')];
}

/** 裸命令名的 well-known 回落扫描：与 PATH 扫描同律（存在 + 执行位），
 *  按目录序首个命中返回，全空 → null。 */
function resolveWellKnown(command: string, dirs: readonly string[]): string | null {
  for (const dir of dirs) {
    const candidate = join(dir, command);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

/** 探针命令执行：同 auth 探针的退出码纪律——**退出码不进判定**，只要 stdout
 *  有内容就照常解析（wrapper / 老 CLI 可能带非零码但输出完整）。 */
function defaultRun(
  command: string,
  args: readonly string[],
  opts: { timeoutMs: number },
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, [...args], { timeout: opts.timeoutMs, encoding: 'utf8' }, (err, stdout) => {
      if (typeof stdout === 'string' && stdout.trim() !== '') {
        resolve({ stdout });
        return;
      }
      reject(err ?? new Error('claude --version produced no stdout'));
    });
  });
}

/** 本机 claude 二进制探测。任何失败（PATH 里没有 / 无执行位 / spawn 失败 /
 *  超时 / 无输出）→ null，永不抛——探测不许把 presence 节拍或上线序列搞挂。 */
export async function probeClaudeBin(opts: ClaudeBinProbeOpts = {}): Promise<ClaudeBinInfo | null> {
  const command = opts.command ?? process.env.CAIRN_CLAUDE_BIN ?? 'claude';
  if (opts.run === undefined) {
    // 真路径：先解析到绝对路径（同时给出「在不在」的判据），再跑版本。
    const env = opts.env ?? process.env;
    const resolved = resolveCommandPath(command, env);
    // #1290：PATH 探空且是裸命令名 → well-known 目录回落（来源点名给日志）。
    const fallback =
      resolved === null && !isAbsolute(command) && !command.includes('/')
        ? resolveWellKnown(command, opts.wellKnownDirs ?? wellKnownClaudeBinDirs(env))
        : null;
    const path = resolved ?? fallback;
    if (path === null) return null;
    const source: 'PATH' | 'well-known' = fallback !== null ? 'well-known' : 'PATH';
    const run = defaultRun;
    try {
      const { stdout } = await run(path, ['--version'], {
        timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
      return { path, version: parseClaudeVersion(stdout), source };
    } catch {
      return null;
    }
  }
  // 注入面（测试）：命令即路径，解析交调用方，只验版本解析面。
  try {
    const { stdout } = await opts.run(command, ['--version'], {
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    return { path: command, version: parseClaudeVersion(stdout) };
  } catch {
    return null;
  }
}
