// claude-code 机器本地凭据预检（#867 T6 / machine-execution-plane §4-9）。
//
// 缺口：runtime 步零凭据注入（spec 17 A4：认证 = 机器本地），跨机派发时
// 「哪台机器上有 claude 凭据」无人过问。机器缺凭据时的实际表现是**静默
// success**：CLI 把 `Not logged in · Please run /login` 当普通回答回给会话，
// result 帧 subtype 仍是 success（is_error=true 被丢弃，见 backend/claude-code
// 的 result 分支）→ 步零产出、零错误面、界面显示完成。
//
// 判据取 CLI 自己的答案（`claude auth status` 的 JSON），不自造凭据源扫描：
// 凭据解析是 CLI 的领域（OAuth 文件 / macOS keychain / settings env /
// apiKeyHelper / Bedrock·Vertex 第三方），复刻一份必然漂移。三态：明确已登录
// / 明确未登录（拦步）/ 说不清（不拦步——预检的假阳性代价是拦掉本可跑的步，
// 比漏放严重，故 fail-open 交给运行期兜底）。
//
// 成本：本机实测 ~140ms，每 runtime 步一次，无网络、无模型调用。

import { execFile } from 'node:child_process';

/** 预检三态。`unknown` = 探针不可用（CLI 缺失/超时/输出不可解析）——调用方
 * 不据此拦步，只记诊断行（运行期兜底见 backend/claude-code 的 result 分支）。 */
export type ClaudeCodeAuthProbe =
  | { state: 'logged-in'; method: string; provider: string }
  | { state: 'not-logged-in'; provider: string }
  | { state: 'unknown'; reason: string };

/** 探针执行的注入面（测试免发真 CLI）。 */
export type ClaudeCodeAuthRun = (
  command: string,
  args: readonly string[],
  opts: { timeoutMs: number },
) => Promise<{ stdout: string }>;

export interface ClaudeCodeAuthProbeOpts {
  /** `claude` 可执行文件（缺省 PATH 解析；`CAIRN_CLAUDE_BIN` 可覆盖）。 */
  command?: string;
  timeoutMs?: number;
  run?: ClaudeCodeAuthRun;
}

const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

/** `claude auth status` stdout → 三态。纯函数：只读 loggedIn（CLI 已把
 * OAuth/keychain/settings env/apiKeyHelper/第三方 provider 全算过），
 * authMethod / apiProvider 只作诊断留痕。缺 loggedIn（更老的 CLI）/ 非
 * JSON / 非对象一律 unknown——不认识的输出不当作「未登录」。 */
export function parseClaudeCodeAuthStatus(stdout: string): ClaudeCodeAuthProbe {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { state: 'unknown', reason: 'claude auth status returned non-JSON output' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { state: 'unknown', reason: 'claude auth status returned a non-object payload' };
  }
  const { loggedIn, authMethod, apiProvider } = parsed as {
    loggedIn?: unknown;
    authMethod?: unknown;
    apiProvider?: unknown;
  };
  if (typeof loggedIn !== 'boolean') {
    return { state: 'unknown', reason: 'claude auth status JSON has no boolean loggedIn' };
  }
  const provider = typeof apiProvider === 'string' ? apiProvider : 'firstParty';
  if (!loggedIn) return { state: 'not-logged-in', provider };
  return {
    state: 'logged-in',
    method: typeof authMethod === 'string' ? authMethod : 'unknown',
    provider,
  };
}

/** 探针命令执行：**非零退出是「未登录」的正常形态**——实测 `claude auth
 * status` 未登录时把完整 JSON 写 stdout 后 exit 1（已登录 exit 0）。故只有
 * 拿不到 stdout（spawn 失败 / 超时被杀）才算探针失败，退出码不进判定
 * （2026-10-05 live 实测踩到：按退出码判会把它折成 unknown → 预检静默失效）。 */
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
      reject(err ?? new Error('claude auth status produced no stdout'));
    });
  });
}

/** 机器本地 claude 凭据预检。任何失败（不在 PATH / 超时 / 无输出）→
 * unknown（含原因，进诊断行），永不抛——预检不许把步搞挂。 */
export async function probeClaudeCodeAuth(
  opts: ClaudeCodeAuthProbeOpts = {},
): Promise<ClaudeCodeAuthProbe> {
  const command = opts.command ?? process.env.CAIRN_CLAUDE_BIN ?? 'claude';
  const run = opts.run ?? defaultRun;
  try {
    const { stdout } = await run(command, ['auth', 'status'], {
      timeoutMs: opts.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    });
    return parseClaudeCodeAuthStatus(stdout);
  } catch (err) {
    return {
      state: 'unknown',
      reason: `probe failed (${command} auth status): ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

/** 缺凭据的显式失败文案（步 errorMessage）：点名机器 + 凭据类 + 补法。
 * 三件缺一即回到「笼统失败」——用户看到的必须是「去修哪台机器、配什么」。 */
export function claudeCodeAuthFailureMessage(machineName: string): string {
  return [
    `claude-code 步骤无法在机器「${machineName}」上执行：该机器没有可用的 Claude Code 凭据`,
    '（预检 `claude auth status` = 未登录）。',
    '补法（在该机器上做，任选其一）：① 运行 `claude` 完成 /login；',
    '② 在 ~/.claude/settings.json 的 env 里配 ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN；',
    '③ 配 apiKeyHelper 输出密钥。',
    '凭据不跨机——每台要跑 claude-code 的机器各自配（cairn 不传登录态）。',
  ].join('');
}
