// AgentBackend 缝的 claude-code 实现（spec 17 T1/#622：第二运行时最小闭环）。
// 缝纪律（01 §5/§7.3 与 pi.ts 同律）：本文件 = daemon 内唯一允许 import
// `@anthropic-ai/claude-agent-sdk` 的模块（biome noRestrictedImports 强制，
// backend/ 目录豁免）。事件面 = 既有 16 型 StepEvent 词表投影（A5 锁定，
// 映射表 spec 17 §事件映射表；映射函数 mapClaudeMessage 为纯函数可单测）。
//
// 凭据纪律（A4 零凭据通道）：claude-code 步的认证 = 机器本地（既有 claude
// 登录或 ANTHROPIC_API_KEY），后端**不消费** SessionOpts.provider（runner 传
// inert 占位满足必填形状）——apiKey 永不进本模块。
//
// 决策面（spec 17 Implementation Decisions）：A6 usage 行集（modelUsage 投影
// + `claude-code/` 键前缀，r3 §1.5 model 键形）；A7 resume 走 SDK `resume`
// + CLI 会话 store 存在性检查（缺失 → SessionNotResumableError，对齐既有
// 冷重试通道）；A8 steer = 流输入队列（下轮消费）——pi 的中途注入语义差异
// 已文档化不抹平，interrupt 归 T2；A9 skills catalog 追加 systemPrompt（复用
// pi 的 buildSkillsCatalog 通道）；A10 工具面已按 #647（T4）接线：host 注入
// 工具（remoteTools relay + localTools 本地执行）包成一个 `pacman` in-process
// MCP server（createSdkMcpServer）交给 SDK，McpEndpoint 映射 SDK 原生 config
// （工具名 `mcp__<slug>__<tool>` 与 pi 原生 MCP 命名同形，#930）；A11 model verbatim
// 透传；A13
// bypassPermissions + readOnly → disallowedTools 收 Edit/Write（SDK 工具名）
// + AskUserQuestion（非交互 daemon 面，Multica claude.go:1078-1092 同律）；
// thinkingLevel → SDK effort（域内透传，off/minimal 缺省不发，域外 fail-closed）。
//
// #1171 原生插件通道：团队技能另经 SDK `plugins`（→ `--plugin-dir`）进 CLI
// 原生 Skill 发现面——落点 daemon 缓存 plugins/ 分区（team-skills.ts
// ensureTeamSkillsPlugin），任务 worktree 零写入；与 A9 catalog 通道并存
// （票面边界），deny 三条规则形不改（alias 命中插件限定名，实测见票评论
// 探针 2）。版本闸/装配失败一律显式日志行 + catalog 兜底，不阻断步。

import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import {
  createSdkMcpServer,
  type EffortLevel,
  type McpServerConfig,
  type Options,
  type Query,
  query,
  type SDKMessage,
  type SDKUserMessage,
  type SdkMcpToolDefinition,
  type SdkPluginConfig,
  type SettingSource,
  tool,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  AgentBackend,
  AgentBackendCapabilities,
  AgentSessionHandle,
  AgentTokenUsage,
  BriefChannel,
  DeliveredImage,
  LocalToolDef,
  McpEndpoint,
  ModelUsage,
  RemoteToolDef,
  SessionOpts,
  StepEvent,
  ToolCallRecord,
} from '@pacman/shared';
import { z } from 'zod';
import { claudeCodeAuthFailureMessage } from '../claude-code-auth.js';
import { ensureTeamSkillsPlugin } from '../team-skills.js';
import { SessionNotResumableError } from './errors.js';
import {
  appendSkillsCatalog,
  collectDeniedSkillDirs,
  collectTeamSkillEntries,
  composeSkillsSection,
  type DeniedSkillEntry,
} from './pi.js';

/** spec 17 :108 能力面。thinkingLevels = SDK effort 五档（pi 七档里
 *  off/minimal 无 SDK 对应——不发 effort 即缺省，见 toEffort）。 */
export const CLAUDE_CODE_CAPABILITIES: AgentBackendCapabilities = {
  name: 'claude-code',
  thinkingLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  oauthProviders: [], // 认证机器本地（A4），无 oauth 订阅面
  compaction: true,
  sessionResume: true,
};

/** usage 行集的 model 键前缀（r3 §1.5 `<provider>/<modelId>` 键形；pi 侧
 *  = `providerId/modelId`，此处 provider 恒 claude-code）。 */
const USAGE_MODEL_PREFIX = 'claude-code';

/** 域外 thinkingLevel fail-closed（A13「域外值不猜」）。 */
const EFFORT_LEVELS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** SDK 工具名（Claude Code 内建面，区别于 pi 的小写名）。 */
const SDK_WRITE_TOOLS = ['Edit', 'Write'];
const SDK_ASK_TOOL = 'AskUserQuestion';

/** 流级可重试判定（pi.ts isRetryableError 同律：瞬态词表正则）。 */
function isRetryableError(message: string): boolean {
  return /rate.?limit|overloaded|timeout|temporarily|5\d\d/i.test(message);
}

// —— SDKMessage → StepEvent 映射（纯函数 + 显式 state）—————————————

/** 映射状态（pi MapState 同位）：工具调用回填、usage 捕获、session_id 刮取、
 *  interrupt 判定（stop() 置位——终态 error 路由 message_stop 而非 error）。 */
export interface ClaudeMapState {
  calls: Map<string, ToolCallRecord>;
  /** stop() 置位：终局 error result 路由 message_stop（词表语义：流被停止）。 */
  interrupted: boolean;
  /** 终局 result 的 usage 行集（handle.usage() 兜底面，pi state.usage 同位）。 */
  usage: AgentTokenUsage;
  /** system init / result 帧刮出的 SDK session_id（A7）。 */
  sessionId: string | null;
  /** modelUsage 缺席时的单行合成键（SessionOpts.modelId 兜底）。 */
  modelId?: string;
  /** auth 类失败已在流里出现（assistant 帧 `error:'authentication_failed'`）——
   * 终局 result 的文案换成显式失败文案（#867 T6；CLI 原文只写「Not logged
   * in」，不点名机器也不说补法）。 */
  authFailed?: boolean;
  /** 本机机器名（auth 失败文案的「哪台机器」位；缺省 = 不点名，仍出文案）。 */
  machineName?: string;
}

export function createClaudeMapState(opts?: {
  modelId?: string;
  machineName?: string;
}): ClaudeMapState {
  return {
    calls: new Map(),
    interrupted: false,
    usage: [],
    sessionId: null,
    ...(opts?.modelId !== undefined ? { modelId: opts.modelId } : {}),
    ...(opts?.machineName !== undefined ? { machineName: opts.machineName } : {}),
  };
}

/** SDK ModelUsage/usage → pacman 行集（A6）。modelUsage 优先（per-model 总计，
 *  含 subagent/sidechain）；缺席时以 result.usage 合成单行（键 = modelId）。 */
function toUsageRows(
  msg: {
    modelUsage?: Record<
      string,
      {
        inputTokens: number;
        outputTokens: number;
        cacheReadInputTokens: number;
        cacheCreationInputTokens: number;
      }
    >;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  },
  modelId: string | undefined,
): ModelUsage[] {
  const entries = Object.entries(msg.modelUsage ?? {});
  if (entries.length > 0) {
    return entries.map(([key, mu]) => ({
      model: `${USAGE_MODEL_PREFIX}/${key}`,
      input: mu.inputTokens,
      output: mu.outputTokens,
      cacheRead: mu.cacheReadInputTokens,
      cacheWrite: mu.cacheCreationInputTokens,
    }));
  }
  if (msg.usage && modelId !== undefined) {
    return [
      {
        model: `${USAGE_MODEL_PREFIX}/${modelId}`,
        input: msg.usage.input_tokens ?? 0,
        output: msg.usage.output_tokens ?? 0,
        cacheRead: msg.usage.cache_read_input_tokens ?? 0,
        cacheWrite: msg.usage.cache_creation_input_tokens ?? 0,
      },
    ];
  }
  return [];
}

/** SDKMessage → StepEvent[]（spec 17 §事件映射表，词表 01 §5 锁定；pi 的
 *  mapPiSessionEvent 同位同律）。结构化窄化按 type/subtype + 字段在位判定；
 *  词表外成员（status/hook/log 类）静默不计。 */
export function mapClaudeMessage(msg: SDKMessage, state: ClaudeMapState): StepEvent[] {
  switch (msg.type) {
    case 'stream_event': {
      const event = (
        msg as {
          event?: { type?: string; delta?: { type?: string; text?: string; thinking?: string } };
        }
      ).event;
      if (event?.type !== 'content_block_delta') return [];
      if (event.delta?.type === 'text_delta' && event.delta.text !== undefined) {
        return [{ type: 'text_delta', text: event.delta.text }];
      }
      if (event.delta?.type === 'thinking_delta' && event.delta.thinking !== undefined) {
        return [{ type: 'thinking_delta', text: event.delta.thinking }];
      }
      return [];
    }
    case 'assistant': {
      const content = (msg as { message?: { role?: string; content?: unknown[] } }).message
        ?.content;
      // 结构化错误类（SDKAssistantMessageError）：auth 类留痕，供终局 result
      // 换显式文案（#867 T6）。识别只认这一档——其它错误类（model_not_found
      // 等）照 CLI 原文上浮，不替它们编话术。
      if ((msg as { error?: unknown }).error === 'authentication_failed') {
        state.authFailed = true;
      }
      if (!Array.isArray(content)) return [];
      const out: StepEvent[] = [];
      for (const block of content) {
        const b = block as {
          type?: string;
          thinking?: string;
          id?: string;
          name?: string;
          input?: unknown;
        };
        if (b.type === 'thinking' && b.thinking !== undefined) {
          // 块终全文（词表语义；增量面已由 thinking_delta 覆盖）。
          out.push({ type: 'thinking', text: b.thinking });
        } else if (b.type === 'tool_use' && typeof b.id === 'string') {
          // pending 段（无 result——词表「live 回传时缺省」）；终稿段由后续
          // user 帧 tool_result 回填（pi 两段发射同律，runner 以 result 在位
          // 门控 relay）。
          const call: ToolCallRecord = {
            id: b.id,
            name: b.name ?? '',
            arguments: b.input,
          };
          state.calls.set(call.id, call);
          out.push({ type: 'toolcall_end', call });
        }
      }
      out.push({
        type: 'message_end',
        message: {
          role: 'assistant',
          content,
        },
      });
      return out;
    }
    case 'user': {
      const content = (msg as { message?: { role?: string; content?: unknown[] } }).message
        ?.content;
      if (!Array.isArray(content)) return [];
      const out: StepEvent[] = [];
      for (const block of content) {
        const b = block as {
          type?: string;
          tool_use_id?: string;
          content?: unknown;
          is_error?: boolean;
        };
        if (b.type !== 'tool_result' || typeof b.tool_use_id !== 'string') continue;
        const pending = state.calls.get(b.tool_use_id);
        if (!pending) continue; // 无 pending 的 tool_result（异机回放等）静默跳过
        const final: ToolCallRecord = {
          ...pending,
          result: b.content,
          isError: b.is_error ?? false,
        };
        state.calls.set(final.id, final);
        out.push({ type: 'toolcall_end', call: final });
      }
      return out;
    }
    case 'system': {
      const subtype = (msg as { subtype?: string }).subtype;
      if (subtype === 'init') {
        const sessionId = (msg as { session_id?: string }).session_id;
        if (typeof sessionId === 'string') state.sessionId = sessionId;
        return []; // A7：session_id 进 handle，不入事件面
      }
      if (subtype === 'compact_boundary') return [{ type: 'compaction' }];
      if (subtype === 'api_retry') {
        const attempt = (msg as { attempt?: number }).attempt;
        return [{ type: 'auto_retry_start', attempt: attempt ?? 1 }];
      }
      return [];
    }
    case 'result': {
      const subtype = (msg as { subtype?: string }).subtype;
      const sessionId = (msg as { session_id?: string }).session_id;
      if (typeof sessionId === 'string' && state.sessionId === null) {
        state.sessionId = sessionId; // result 帧兜底刮取（Multica 同律）
      }
      const rows = toUsageRows(msg as Parameters<typeof toUsageRows>[0], state.modelId);
      state.usage = rows;
      // 终局真话 = is_error（SDK 明示：API 出错时 subtype 仍是 success，错误
      // 文本在 result 字段）。只看 subtype 会把「未登录 / 模型不存在」这类
      // 零 token 的拒绝折成正常收工（#867 T6 实测：跑在无凭据机器上的步
      // 静默 success、零产出、无错误面）。
      const isError = (msg as { is_error?: boolean }).is_error === true;
      if (subtype === 'success' && !isError) {
        return [{ type: 'done', usage: rows }];
      }
      const errors = (msg as { errors?: string[] }).errors ?? [];
      const resultText = (msg as { result?: unknown }).result;
      const cliMessage =
        errors.length > 0
          ? errors.join('; ')
          : typeof resultText === 'string' && resultText !== ''
            ? resultText
            : (subtype ?? 'unknown error');
      // 缺凭据是跨机派发的头号故障（#867 T6）：CLI 原文只说「未登录」，不说
      // 哪台机器、怎么补——换成显式文案（机器名由宿主注入）。
      const message = state.authFailed
        ? claudeCodeAuthFailureMessage(state.machineName ?? hostname())
        : cliMessage;
      if (state.interrupted) {
        // interrupt 终态（stop()/watchdog abort）：流被停止语义（词表
        // message_stop），非失败——stopped 收尾归 runner stopRequests 判定。
        return [
          {
            type: 'message_stop',
            message: { role: 'assistant', content: [{ type: 'text', text: message }] },
          },
        ];
      }
      return [{ type: 'error', error: { message, retryable: isRetryableError(message) } }];
    }
    default:
      return [];
  }
}

// —— 流输入队列与事件队列（AsyncQueue 泛型；pi EventQueue 同构）—————————

/** push → AsyncIterable pull（无界缓冲 [设计]：与 pi EventQueue 同律，背压
 *  面归实现期后票）。事件面（StepEvent）与 SDK 流输入面（SDKUserMessage）
 *  共用本形。 */
class AsyncQueue<T> {
  private readonly items: T[] = [];
  private waiter: ((r: IteratorResult<T>) => void) | null = null;
  private ended = false;

  push(item: T): void {
    if (this.ended) return;
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve({ value: item, done: false });
      return;
    }
    this.items.push(item);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve({ value: undefined as unknown as T, done: true });
    }
  }

  private next(): Promise<IteratorResult<T>> {
    const item = this.items.shift();
    if (item !== undefined) return Promise.resolve({ value: item, done: false });
    if (this.ended) {
      return Promise.resolve({ value: undefined as unknown as T, done: true });
    }
    return new Promise<IteratorResult<T>>((resolve) => {
      this.waiter = resolve;
    });
  }

  iterable(): AsyncIterable<T> {
    const self = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<T> {
        return { next: () => self.next() };
      },
    };
  }
}

// —— 会话句柄 ——————————————————————————————————————————————

/** 终局事件（result 帧产物）：之后收事件面并清资源（流输入会话在终局后
 *  挂起等下一轮输入，daemon 步无下一轮——不收尾即 streamIdle 超时假失败）。 */
const TERMINAL_EVENT_TYPES: readonly string[] = ['done', 'error', 'message_stop'];

class ClaudeSessionHandle implements AgentSessionHandle {
  readonly sessionId: string;
  readonly events: AsyncIterable<StepEvent>;
  private readonly queue = new AsyncQueue<StepEvent>();
  private readonly input: AsyncQueue<SDKUserMessage>;
  private readonly state: ClaudeMapState;
  private readonly q: Query;
  private readonly abort: AbortController;
  private closed = false;
  private stopping = false;

  constructor(
    q: Query,
    opts: {
      sessionId: string;
      state: ClaudeMapState;
      abort: AbortController;
      input: AsyncQueue<SDKUserMessage>;
    },
  ) {
    this.q = q;
    this.sessionId = opts.sessionId;
    this.state = opts.state;
    this.abort = opts.abort;
    this.input = opts.input;
    this.events = this.queue.iterable();
    void this.pump();
  }

  /** SDKMessage 泵 → 映射 → 事件面。终局事件（done/error/message_stop）收
   *  事件面；生成器耗尽（输入流关后 query 自然收尾）= 无终局兜底收面。 */
  private async pump(): Promise<void> {
    try {
      for await (const msg of this.q) {
        for (const ev of mapClaudeMessage(msg, this.state)) {
          this.queue.push(ev);
          if (TERMINAL_EVENT_TYPES.includes(ev.type)) {
            this.finish();
            return;
          }
        }
      }
      this.queue.end();
    } catch (err) {
      // abort/interrupt 面吞错（pi stopping 同律）：stopped 收尾归 runner
      // stopRequests 旗标，错误文本不冒充失败原因。
      if (this.stopping) {
        this.queue.end();
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.queue.push({ type: 'error', error: { message, retryable: false } });
      this.queue.end();
    }
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.input.end(); // 流尾 → query 收尾（流输入会话不挂起）
    this.queue.end();
    if (!this.abort.signal.aborted) this.abort.abort(); // 资源清理（SDK 契约）
  }

  /** steer = 流输入队列（下轮消费）+ steer 事件（A8：与 pi 中途注入语义有
   *  已知差异，文档化不抹平；interrupt 归 T2）。images = #730 随话交付的
   *  图片（内联 image content block 同 prompt 面机制）。 */
  async steer(text: string, images?: readonly DeliveredImage[]): Promise<void> {
    this.input.push(buildUserMessage(text, images));
    this.queue.push({ type: 'steer', text });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.state.interrupted = true; // 终局 error result 路由 message_stop
    this.input.end();
    this.q.interrupt().catch(() => {}); // 旧 CLI 无回执 → resolve undefined
    this.finish();
  }

  usage(): AgentTokenUsage {
    return this.state.usage;
  }
}

/** 流输入用户帧（MessageParam 文本形；parent_tool_use_id = 顶层消息位 null）。
 * #730：携带图片时 content 升为块数组 [text, image...]——Claude Code 本尊
 * 粘贴同机制（parent 正典 §Part 2：inline image content block 进用户消息，
 * 支持 png/jpeg/gif/webp）；SDKUserMessage.message = MessageParam，content
 * 块数组是 SDK 明示的合法形。无图片时恒 string（既有 wire 零漂移）。 */
export function buildUserMessage(text: string, images?: readonly DeliveredImage[]): SDKUserMessage {
  if (images === undefined || images.length === 0) {
    return {
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
    };
  }
  return {
    type: 'user',
    message: { role: 'user', content: [textBlock(text), ...images.map(toImageBlock)] },
    parent_tool_use_id: null,
  };
}

function textBlock(text: string): { type: 'text'; text: string } {
  return { type: 'text', text };
}

/** 内联交付面的 media_type 字面量联合（SDK Base64ImageSource 的类型面；
 * 运行时保证 = resolver inlineMime 只放行 png/jpeg/gif/webp 四值）。 */
type InlineImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

/** DeliveredImage → Anthropic image block（base64 source 三字段缺一不可）。 */
export function toImageBlock(img: DeliveredImage): {
  type: 'image';
  source: { type: 'base64'; media_type: InlineImageMediaType; data: string };
} {
  return {
    type: 'image',
    // mimeType 恒在四值联合内（resolver inlineMime 收口）——cast = 类型面
    // 与运行时保证的对齐，不是放宽。
    source: { type: 'base64', media_type: img.mimeType as InlineImageMediaType, data: img.data },
  };
}

/** CLI 会话 store 惯例 [推断]（r4-foundation 调研；Multica claude.go:936-972
 *  同源）：~/.claude/projects/<cwd-slug>/<sessionId>.jsonl。存在性 = resume
 *  资格的本地判据（空 store/换机 → SessionNotResumableError 冷重试一次）。
 *  cwd 先过 realpath：CLI 子进程 cwd 由内核解析符号链接（macOS 工作区
 *  /tmp → /private/tmp），slug 按解析后路径计——不解析则 /tmp 起头的工作区
 *  预检恒 miss（#622 verify 实跑：resume 恒回退冷启）。 */
export function sdkTranscriptPath(cwd: string, sessionId: string): string {
  let resolved = cwd;
  try {
    resolved = realpathSync(cwd);
  } catch {
    // cwd 缺失 = 无会话文件可寻，原路径判 miss（resume 冷重试通道兜底）。
  }
  return join(
    homedir(),
    '.claude',
    'projects',
    resolved.replaceAll('/', '-'),
    `${sessionId}.jsonl`,
  );
}

// —— T4 工具面（#647：SDK mcpServers + createSdkMcpServer in-process 回调）——
// host 注入工具（remoteTools relay / localTools 本地执行）包成一个 `pacman`
// in-process MCP server；McpEndpoint 映射 SDK 原生 config。与 pi customTool 的
// 已知语义差异（票面明示不抹平）：工具名经 MCP 面恒带 `mcp__pacman__` 前缀
// （pi 裸名）；参数经 zod shape 解析——多出的键被剥、缺 required 报错给模型
// 自纠（pi 透传 server 校验）。

/** host 注入工具的 in-process server 名（工具名形 `mcp__pacman__<name>`）。 */
const HOST_MCP_SERVER_NAME = 'pacman';

/** JSON Schema 词表（host 注入面现行为全集，chief-tools obj/str/arr/bool/num
 *  帮手产物 + 本地工具同形）。词表外形态（type 或键）fail-closed：静默丢
 *  enum/oneOf 这类约束会让模型看到与 server 校验面漂移的参数形。 */
function jsonSchemaToZod(schema: unknown, where: string): z.ZodType {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    throw new Error(`claude-code backend: tool schema ${where} must be an object (fail-closed)`);
  }
  const def = schema as {
    type?: unknown;
    description?: unknown;
    items?: unknown;
    properties?: unknown;
    required?: unknown;
  };
  const description = typeof def.description === 'string' ? def.description : undefined;
  const describe = (t: z.ZodType) => (description !== undefined ? t.describe(description) : t);
  const forbidKeys = (allowed: readonly string[]) => {
    const extra = Object.keys(schema as Record<string, unknown>).filter(
      (k) => !allowed.includes(k),
    );
    if (extra.length > 0) {
      throw new Error(
        `claude-code backend: tool schema ${where} keys [${extra.join(',')}] not in vocabulary (fail-closed)`,
      );
    }
  };
  switch (def.type) {
    case 'string':
      forbidKeys(['type', 'description']);
      return describe(z.string());
    case 'number':
      forbidKeys(['type', 'description']);
      return describe(z.number());
    case 'boolean':
      forbidKeys(['type', 'description']);
      return describe(z.boolean());
    case 'array':
      forbidKeys(['type', 'description', 'items']);
      return describe(z.array(jsonSchemaToZod(def.items, `${where}.items`)));
    case 'object': {
      forbidKeys(['type', 'description', 'properties', 'required']);
      if (
        def.properties === undefined ||
        typeof def.properties !== 'object' ||
        def.properties === null ||
        Array.isArray(def.properties)
      ) {
        throw new Error(
          `claude-code backend: tool schema ${where} object properties must be an object (fail-closed)`,
        );
      }
      if (
        def.required !== undefined &&
        (!Array.isArray(def.required) || def.required.some((k) => typeof k !== 'string'))
      ) {
        throw new Error(
          `claude-code backend: tool schema ${where} required must be string[] (fail-closed)`,
        );
      }
      const required = new Set((def.required as string[] | undefined) ?? []);
      const shape: Record<string, z.ZodType> = {};
      for (const [key, sub] of Object.entries(def.properties)) {
        const field = jsonSchemaToZod(sub, `${where}.properties.${key}`);
        shape[key] = required.has(key) ? field : field.optional();
      }
      return describe(z.object(shape));
    }
    default:
      throw new Error(
        `claude-code backend: tool schema ${where} type '${String(def.type)}' not in vocabulary (fail-closed)`,
      );
  }
}

/** 工具 parameters（顶层 JSON Schema object）→ zod raw shape（inputSchema 形）。
 *  parameters 缺省 = 空参工具（shape {}）。顶层非 object 形 fail-closed。 */
export function parametersToShape(
  parameters: unknown,
  toolName: string,
): Record<string, z.ZodType> {
  if (parameters === undefined || parameters === null) return {};
  if (
    typeof parameters !== 'object' ||
    Array.isArray(parameters) ||
    (parameters as { type?: unknown }).type !== 'object'
  ) {
    throw new Error(
      `claude-code backend: tool '${toolName}' parameters must be an object schema (fail-closed)`,
    );
  }
  // jsonSchemaToZod 的 object 分支恒返回 ZodObject（顶层 type 已判 'object'）。
  return (jsonSchemaToZod(parameters, `'${toolName}'.parameters`) as z.ZodObject).shape;
}

/** host 注入工具源（buildHostTools 入参；测试可注入 mock relay/execute）。 */
export interface HostToolSources {
  remoteTools: readonly RemoteToolDef[];
  /** relay 执行回调（runner 注入 = POST /api/machine/tool/<stepId>）。 */
  relay?: (name: string, params: Record<string, unknown>) => Promise<string>;
  localTools: readonly LocalToolDef[];
}

/** remoteTools + localTools → in-process server 工具集。remoteTools 非空而
 *  relay 缺席 = 内部不变量破裂（runner 恒成对注入），fail-closed 不静默丢。
 *  handler 闭包钉 def.name 发 relay——CLI 工具名带 `mcp__pacman__` 前缀，
 *  relay 协议按裸名匹配（服务端 switch(name) 词表）。拒绝/传输失败 → 工具
 *  结果文本（pi customTool 同律，不抛断回合）；isError 位给模型显式错误信号
 *  （MCP 原生通道，pi 侧无此概念——transcript 行 isError 随之可观测）。 */
export function buildHostTools(sources: HostToolSources): SdkMcpToolDefinition[] {
  if (sources.remoteTools.length > 0 && !sources.relay) {
    throw new Error('claude-code backend: remoteTools require executeRemoteTool (fail-closed)');
  }
  const tools: SdkMcpToolDefinition[] = [];
  for (const def of sources.remoteTools) {
    const shape = parametersToShape(def.parameters, def.name);
    tools.push(
      tool(def.name, def.description, shape, async (params: Record<string, unknown>) => {
        try {
          const text = await sources.relay?.(def.name, params ?? {});
          return { content: [{ type: 'text' as const, text: text ?? '' }] };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: 'text' as const, text: `${def.name} rejected: ${msg}` }],
            isError: true,
          };
        }
      }),
    );
  }
  for (const def of sources.localTools) {
    const shape = parametersToShape(def.parameters, def.name);
    tools.push(
      tool(def.name, def.description, shape, async (params: Record<string, unknown>) => {
        try {
          const text = await def.execute(params ?? {});
          return { content: [{ type: 'text' as const, text }] };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: 'text' as const, text: `${def.name} failed: ${msg}` }],
            isError: true,
          };
        }
      }),
    );
  }
  return tools;
}

/** McpEndpoint → SDK 原生 config（T4 第三面）：http → {type:'http'}；stdio →
 *  {type:'stdio'}；字段残缺 fail-closed。alwaysLoad 钉 true——pi 原生 MCP
 *  （#930）是预连接 + 全量工具面（工具恒在 prompt），对齐该语义（代价 = 启
 *  动等连接上限 5s，与 pi 预连接同量级）。 */
export function mapMcpEndpoint(endpoint: McpEndpoint): McpServerConfig {
  if (endpoint.transport === 'http') {
    if (typeof endpoint.url !== 'string' || endpoint.url === '') {
      throw new Error(
        `claude-code backend: mcp server '${endpoint.slug}' http transport requires url (fail-closed)`,
      );
    }
    return {
      type: 'http',
      url: endpoint.url,
      ...(endpoint.headers !== undefined ? { headers: endpoint.headers } : {}),
      alwaysLoad: true,
    };
  }
  if (typeof endpoint.command !== 'string' || endpoint.command === '') {
    throw new Error(
      `claude-code backend: mcp server '${endpoint.slug}' stdio transport requires command (fail-closed)`,
    );
  }
  return {
    type: 'stdio',
    command: endpoint.command,
    ...(endpoint.args !== undefined ? { args: [...endpoint.args] } : {}),
    ...(endpoint.env !== undefined ? { env: endpoint.env } : {}),
    alwaysLoad: true,
  };
}

// —— 技能可见面收归（#917，spec 14 §技能可见面收归）———————————————

/** 口径 3：settings 加载源从「SDK 缺省（omitted = 全部加载）」改成产品显式
 * 声明——缺省行为一变，agent 能力面会静默塌方且无人收到告警。`'project'` 是
 * CLAUDE.md 简报的承重位（spec 24 §通道漂移：缺它简报零报错地消失），动这个
 * 列表前先重验简报存活。 */
export const CLAUDE_SETTING_SOURCES: readonly SettingSource[] = ['user', 'project', 'local'];

/** gitignore 元字符转义（deny 路径规则用；CLI 自家「don't ask again」落规则
 * 时同法转义，解析面认反斜杠形）。行首 `!`/`#` 的特殊位只在 pattern 头——
 * 本仓规则恒以 `//` 起头，无需处理。 */
export function escapeGitignorePath(path: string): string {
  return path.replaceAll(/([\\*?[\]])/g, '\\$1');
}

/** 未授权技能 → deny 规则三条/技能（口径 4）。deny 规则在包括
 * bypassPermissions 在内的每个 permission mode 都生效（docs/verify/917 实物
 * 对照 A1/A2/B5）。
 * ① `Read(//<baseDir>/**)` = 文件工具面：`//` 前缀 = 文件系统根锚定的
 *    gitignore 形（Claude Code permissions 正典）；Read 面 deny 同路径连带挡
 *    Edit/Write（bundled CLI 2.1.278 ≥ 2.1.208 语义）。daemon 机器面 =
 *    macOS/Linux，posix 绝对路径形足够（Windows 归一化 `//c/...` 不在本缝范围）。
 * ② `Skill(<name>)` + ③ `Skill(skill:<name>)` = Skill 工具面：① 挡不住它——
 *    Skill 调用加载 SKILL.md 不走 Read 权限检查（verify/917 B4 实测），必须
 *    独立成规；`skill:` 前缀形按官方语义匹配该技能任一名字（alias/display），
 *    与精确形并发双保险。SDK `skills` 选项不采：实测只翻译成 allow 规则，
 *    bypassPermissions 下无效果、原生清单分毫不动（verify/917 run1 B2）。 */
export function buildSkillDenyRules(denied: readonly DeniedSkillEntry[]): string[] {
  return denied.flatMap((d) => [
    `Read(/${escapeGitignorePath(d.baseDir)}/**)`,
    `Skill(${d.name})`,
    `Skill(skill:${d.name})`,
  ]);
}

// —— 原生插件通道（#1171）：团队技能进 Claude Code 原生 Skill 发现面 ——————
// SDK `plugins` 选项（pluginDelivery 缺省 'argv' → 每插件一个 `--plugin-dir`
// 旗标）把 daemon 缓存 plugins/ 分区里的插件目录交给 CLI 原生加载：技能以
// `pacman-team-skills:<name>` 限定形进 Skill 工具清单（alias = 非限定名），
// 任务 worktree 零写入。deny 三条规则形不改一字即命中插件限定名（alias
// 匹配；#1171 调研评论探针 2 实测），allowed 技能不误伤。catalog XML 简报
// 通道照常并存（票面边界）——本通道任何失败都回落 catalog，不阻断步。

/** 版本下限：`--plugin-dir` 旗标的最早可证版本（anthropics/claude-code
 *  CHANGELOG 2.1.74「Changed --plugin-dir so local dev copies now override
 *  installed marketplace plugins…」——Changed 条目 = 该版旗标已在；插件系统
 *  本身 2.0.12 发布）。低于下限的 CLI 收到 --plugin-dir 会以 unknown-option
 *  退出——跳过插件通道保 catalog 兜底（零回归），别把步炸在旗标上。 */
export const MIN_CLAUDE_PLUGIN_VERSION = '2.1.74';

/** 版本号数值段比较（前三段数值；`2.1.289-beta.3` 取数值前缀）。解析失败 /
 *  null / 缺省 = false（fail-closed：版本不可证 → 跳过插件通道，catalog
 *  兜底）。版本源 = #1050 探测单源（machine-loop executableVersion 接线）。 */
export function claudeVersionAtLeast(version: string | null | undefined, min: string): boolean {
  const parse = (v: string): number[] | null => {
    const parts = v
      .split('.')
      .slice(0, 3)
      .map((p) => {
        const m = /^(\d+)/.exec(p);
        return m === null ? Number.NaN : Number.parseInt(m[1] ?? '', 10);
      });
    return parts.length === 3 && parts.every((n) => !Number.isNaN(n)) ? parts : null;
  };
  if (version == null) return false;
  const a = parse(version);
  const b = parse(min);
  if (a === null || b === null) return false;
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

export interface TeamSkillsPluginParts {
  /** 后端 skills 扫描配置（catalog/deny 同源）；缺省 = 未配置注入面。 */
  skills: { skillsDir: string; cwd: string } | undefined;
  /** 团队技能缓存根（StatePaths.teamSkillsCacheDir 单源，machine-loop 接线）；
   * 缺省 = 通道未接线 → null + 显式行（接线缺失必须可见，不静默死）。 */
  cacheRoot: string | undefined;
  /** #1050 探测版本（null/不可解析 = 按下限以下处理，fail-closed）。 */
  executableVersion: string | null | undefined;
  /** 会话面技能参数（SessionOpts 投影：授权白名单 + 团队视图目录）。
   * injectedSkills 在形但**不消费**——注入选择是 catalog 通道语义，不越
   * native 授权面（#917 同律；P3 测试钉住）。 */
  session: { skillsAllowlist?: string[]; injectedSkills?: string[]; teamSkillsDir?: string };
  log?: (msg: string) => void;
}

/** 插件通道解析面（纯组合可单测；open() 只接线）。顺序 = 版本闸 → allowed
 * 集（collectTeamSkillEntries，与 catalog/deny 同扫描源；白名单外技能构造性
 * 不在插件里 = deny 面零回退）→ ensureTeamSkillsPlugin 装配。null = 通道关；
 * 除 teamSkillsDir 缺省（纯本机步，无信号噪声）外每个 null 都有显式日志行。
 * injectedSkills 不参与——注入选择是 catalog 通道语义（#917 同律）。 */
export function resolveTeamSkillsPluginDir(parts: TeamSkillsPluginParts): string | null {
  const viewDir = parts.session.teamSkillsDir;
  if (viewDir === undefined) return null;
  const log = parts.log;
  if (parts.cacheRoot === undefined) {
    log?.('native-plugin: skipped (team-skills cache root not wired; catalog channel only)');
    return null;
  }
  if (!claudeVersionAtLeast(parts.executableVersion, MIN_CLAUDE_PLUGIN_VERSION)) {
    log?.(
      `native-plugin: skipped (claude ${parts.executableVersion ?? 'unparsed'} < ${MIN_CLAUDE_PLUGIN_VERSION}; catalog channel only)`,
    );
    return null;
  }
  const entries = collectTeamSkillEntries(parts.skills, {
    ...(parts.session.skillsAllowlist !== undefined
      ? { skillsAllowlist: parts.session.skillsAllowlist }
      : {}),
    teamSkillsDir: viewDir,
  });
  if (entries.length === 0) {
    log?.('native-plugin: 0 allowed team skill(s); not delivered (catalog channel only)');
    return null;
  }
  const dir = ensureTeamSkillsPlugin({
    cacheRoot: parts.cacheRoot,
    viewDir,
    dirNames: entries.map((e) => e.dirName),
    ...(log !== undefined ? { log } : {}),
  });
  if (dir !== null) log?.(`native-plugin: ${entries.length} skill(s) → ${dir}`);
  return dir;
}

/** sdkOptions 组装面（纯函数可单测；open() 只备料）。skillDenyRules =
 * buildSkillDenyRules 产物（口径 4 硬挡）；空/缺省 = settings 键不发
 * （chief 面 CLI 默认行为零回归）。SDK `skills` 键恒不发——见
 * buildSkillDenyRules 注释的实测依据。 */
export interface ClaudeSdkOptionParts {
  cwd: string;
  modelId: string;
  resumeId: string | null;
  sessionId: string;
  disallowedTools: string[];
  mcpServers: Record<string, McpServerConfig>;
  effort?: EffortLevel;
  /** systemPrompt preset append（#958 后仅无简报通道的调用面非空）。 */
  append?: string;
  skillDenyRules?: string[];
  /** #1050：可执行文件绝对路径（探测结果单源）。缺席 = 不发键，SDK 自解析。 */
  executablePath?: string;
  /** #1148 步级 env（SessionOpts.env 透传；worker 步端口基座）。缺席 = 不发
   * env 键（subprocess 继承 process.env，现行为）。 */
  env?: Record<string, string>;
  /** #1171 原生插件通道（resolveTeamSkillsPluginDir 产物）。缺席/空 = 键
   * 不发（chief 面与无团队技能面零漂移）。pluginDelivery 恒不发：缺省
   * 'argv'（每插件一个 --plugin-dir 旗标）兼容全版本段；'initialize' 形要求
   * CLI ≥ 2.1.261，高于本通道的证据下限 2.1.74，不采。skipMcpDiscovery 同理
   * 不发（翻译成 --plugin-dir-no-mcp，下限无实证）——插件目录由 daemon 自建
   * （只有 .claude-plugin/ + skills/），构造面无 .mcp.json 可读。 */
  plugins?: SdkPluginConfig[];
  abortController: AbortController;
}

export function buildClaudeSdkOptions(parts: ClaudeSdkOptionParts): Options {
  return {
    cwd: parts.cwd,
    model: parts.modelId,
    permissionMode: 'bypassPermissions',
    disallowedTools: parts.disallowedTools,
    includePartialMessages: true, // text_delta/thinking_delta 增量面
    settingSources: [...CLAUDE_SETTING_SOURCES],
    ...(Object.keys(parts.mcpServers).length > 0 ? { mcpServers: parts.mcpServers } : {}),
    ...(parts.effort !== undefined ? { effort: parts.effort } : {}),
    ...(parts.append !== undefined
      ? {
          systemPrompt: {
            type: 'preset' as const,
            preset: 'claude_code' as const,
            append: parts.append,
          },
        }
      : {}),
    ...(parts.resumeId !== null ? { resume: parts.resumeId } : { sessionId: parts.sessionId }),
    ...(parts.skillDenyRules !== undefined && parts.skillDenyRules.length > 0
      ? { settings: { permissions: { deny: [...parts.skillDenyRules] } } }
      : {}),
    ...(parts.executablePath !== undefined
      ? { pathToClaudeCodeExecutable: parts.executablePath }
      : {}),
    // #1148：SDK env 是**整替**语义（不与 process.env 合并）——必须先展开
    // process.env 保 PATH/HOME/ANTHROPIC_* 等继承位，per-step 值最后覆盖。
    ...(parts.env !== undefined ? { env: { ...process.env, ...parts.env } } : {}),
    // #1171：原生插件通道（团队技能 → CLI Skill 发现面）。空/缺省 = 键不发。
    ...(parts.plugins !== undefined && parts.plugins.length > 0 ? { plugins: parts.plugins } : {}),
    abortController: parts.abortController,
  };
}

// —— 后端 ——————————————————————————————————————————————————

export interface ClaudeCodeBackendOpts {
  /** skills 执行面注入（spec 14/#371，A9 复用 pi 通道）：skillsDir =
   *  PACMAN_SKILLS_DIR 扫描根；cwd = daemon home。缺省 = 不注入。 */
  skills?: { skillsDir: string; cwd: string };
  /** `[skills]` 诊断行出口（machine-loop 接 logger.skills，与 pi 同型）。 */
  onSkillsLog?: (msg: string) => void;
  /** 本机机器名（#867 T6：缺凭据失败文案的「哪台机器」位；缺省 = os.hostname()）。 */
  machineName?: string;
  /** claude 可执行文件绝对路径（#1050：machine-loop 探测结果单源，透传到
   *  SDK 的 pathToClaudeCodeExecutable）。缺席 = 探测没找到（启动即报）或
   *  注入面测试——两种情况都回到 SDK 自己的 PATH 解析。 */
  executablePath?: string;
  /** #1171 原生插件通道：团队技能缓存根（StatePaths.teamSkillsCacheDir 单源，
   *  machine-loop 接线；plugins/ 分区在其下）。缺席 = 通道关（注入面测试）。 */
  teamSkillsCacheDir?: string;
  /** #1050 探测版本（插件通道版本下限闸输入，MIN_CLAUDE_PLUGIN_VERSION）。
   *  缺席/null/不可解析 = fail-closed 跳过插件通道（catalog 兜底）。 */
  executableVersion?: string | null;
}

export class ClaudeCodeBackend implements AgentBackend {
  readonly capabilities = CLAUDE_CODE_CAPABILITIES;

  /** 简报文件通道（#958）：SDK 只在 `settingSources` 含 `'project'` 时读
   * worktree 的 CLAUDE.md。#917 起该选项由 buildClaudeSdkOptions 显式钉成
   * CLAUDE_SETTING_SOURCES（含 'project'）——承重位从「依赖 SDK 缺省」变成
   * 「产品声明 + 单测钉值」；改动那份列表前先重验简报存活（spec 24 §通道漂移）。
   * AGENTS.md 一概不读。 */
  readonly brief: BriefChannel = {
    backendId: 'claude-code',
    composeBody: (opts, base) =>
      appendSkillsCatalog(
        base,
        composeSkillsSection(this.opts.skills, opts, this.opts.onSkillsLog),
      ) ?? '',
  };

  constructor(private readonly opts: ClaudeCodeBackendOpts) {}

  async createSession(opts: SessionOpts): Promise<AgentSessionHandle> {
    return this.open(opts, null);
  }

  async continueSession(id: string, opts: SessionOpts): Promise<AgentSessionHandle> {
    if (!existsSync(sdkTranscriptPath(opts.cwd, id))) {
      throw new SessionNotResumableError(id);
    }
    return this.open(opts, id);
  }

  private async open(opts: SessionOpts, resumeId: string | null): Promise<AgentSessionHandle> {
    // T4 工具面（#647）：host 注入工具（remoteTools relay + localTools 本地
    // 执行）包成一个 in-process MCP server；McpEndpoint 映射 SDK 原生 config。
    // T1 的四条 fail-closed 到此退役——工具面缺席（三面全空）= 不建 server，
    // Options.mcpServers 不发（既有调用面零变化）。
    const hostTools = buildHostTools({
      remoteTools: opts.remoteTools ?? [],
      ...(opts.executeRemoteTool ? { relay: opts.executeRemoteTool } : {}),
      localTools: opts.localTools ?? [],
    });
    const mcpServers: Record<string, McpServerConfig> = {};
    if (hostTools.length > 0) {
      mcpServers[HOST_MCP_SERVER_NAME] = createSdkMcpServer({
        name: HOST_MCP_SERVER_NAME,
        alwaysLoad: true, // 50 件 chief 词表必须全量进 prompt（不defer 给工具搜索）
        tools: hostTools,
      });
    }
    for (const endpoint of opts.mcpServers ?? []) {
      if (endpoint.slug === HOST_MCP_SERVER_NAME) {
        throw new Error(
          `claude-code backend: mcp server slug '${endpoint.slug}' collides with the host tool server (fail-closed)`,
        );
      }
      mcpServers[endpoint.slug] = mapMcpEndpoint(endpoint);
    }
    // A13 thinkingLevel → effort：域内透传；off/minimal 缺省不发（SDK 无对应
    // 档）；域外 fail-closed 不猜。
    const effort = toEffort(opts.thinkingLevel);
    // skills catalog 的落点自 #958 起归简报文件通道（见 this.brief）：目录内容由
    // `composeSections` 产出、runner 写进 worktree 的 CLAUDE.md，SDK 经
    // `settingSources` 的 'project' 档原生读取（#917 起显式钉值，'project' 不得被摘）。
    // 这里只透传 runner 给的 systemPrompt——**只有**不具备简报通道的后端才拿得到
    // 非空值。
    const append = opts.systemPrompt;
    // A4 零凭据：不消费 opts.provider（inert 占位）；A11 model verbatim；
    // A13 bypassPermissions + disallowedTools（readOnly 收 Edit/Write）。
    // #1049 起 AskUserQuestion 仍恒拒，理由换血：SDK 原生问答工具与 pacman 的
    // 结构化 ask_user（mcp__pacman__ask_user，阻塞语义 = in-process MCP 工具
    // 调用默认无超时）是同一能力的两个面——留一个通道（pacman 词表件），问答
    // 卡/幂等/收口全走 server 单源；实测 SDK 会话里原生工具本就不进 toolset
    // （verify/1049 probe：模型自报「no AskUserQuestion tool in my toolset」，
    // onUserDialog + supportedDialogKinds 已声明也不改变）。
    const disallowedTools = [SDK_ASK_TOOL, ...(opts.readOnly === true ? SDK_WRITE_TOOLS : [])];
    const abort = new AbortController();
    const sessionId = resumeId ?? randomUUID(); // 自铸 UUID（A7 通道同值回传）
    // 白名单硬挡（#917 口径 4）：未授权技能进 settings.permissions.deny
    // （Read 路径规则挡文件工具面 + Skill 名规则挡 Skill 工具面）——deny 规则
    // 在 bypassPermissions 下仍生效（deny 不属被 bypass 的「prompt」面；实物
    // 对照 docs/verify/917）。chief 步拒绝集恒空 = 不发 settings 键，零回归。
    const deniedSkills = collectDeniedSkillDirs(this.opts.skills, opts);
    const skillDenyRules = buildSkillDenyRules(deniedSkills);
    if (deniedSkills.length > 0) {
      this.opts.onSkillsLog?.(`deny: ${deniedSkills.length} skill dir(s) hard-blocked`);
    }
    // #1171 原生插件通道：团队技能经 SDK plugins（→ --plugin-dir）进 CLI
    // 原生 Skill 发现面（落点 = daemon 缓存 plugins/ 分区，任务 worktree 零
    // 写入）。白名单外技能构造性不在插件里（deny 面零回退，规则三条不改）；
    // 版本闸/装配失败 = 显式日志行 + catalog XML 通道兜底，不阻断步。
    const nativePluginDir = resolveTeamSkillsPluginDir({
      skills: this.opts.skills,
      cacheRoot: this.opts.teamSkillsCacheDir,
      executableVersion: this.opts.executableVersion,
      session: opts,
      ...(this.opts.onSkillsLog !== undefined ? { log: this.opts.onSkillsLog } : {}),
    });
    const sdkOptions: Options = buildClaudeSdkOptions({
      cwd: opts.cwd,
      modelId: opts.modelId,
      resumeId,
      sessionId,
      disallowedTools,
      mcpServers,
      ...(effort !== undefined ? { effort } : {}),
      ...(append !== undefined ? { append } : {}),
      skillDenyRules,
      ...(this.opts.executablePath !== undefined
        ? { executablePath: this.opts.executablePath }
        : {}),
      // #1148 步级 env（worker 步端口基座）→ SDK 子进程环境（整替 + 展开）。
      ...(opts.env !== undefined ? { env: opts.env } : {}),
      // #1171 原生插件通道（null = 通道关，键不发）。
      ...(nativePluginDir !== null
        ? { plugins: [{ type: 'local' as const, path: nativePluginDir }] }
        : {}),
      abortController: abort,
    });
    const state = createClaudeMapState({
      modelId: opts.modelId,
      machineName: this.opts.machineName ?? hostname(),
    });
    // 流输入队列（query 消费面 = 同一实例）：首轮任务文本先入队（02 §4.2
    // createSession = 首条用户消息；缺省 = 开会话不发轮，队列空但保持打开）。
    // #730：promptImages 随首轮用户消息内联（块数组形）。
    const input = new AsyncQueue<SDKUserMessage>();
    if (opts.prompt !== undefined) input.push(buildUserMessage(opts.prompt, opts.promptImages));
    const q = query({ prompt: input.iterable(), options: sdkOptions });
    return new ClaudeSessionHandle(q, { sessionId, state, abort, input });
  }
}

/** thinkingLevel → SDK effort（A13）：off/minimal = 不发（缺省档）；域内
 *  透传；域外 fail-closed。 */
function toEffort(level: string | undefined): EffortLevel | undefined {
  if (level === undefined || level === 'off' || level === 'minimal') return undefined;
  if (EFFORT_LEVELS.includes(level)) return level as EffortLevel;
  throw new Error(`claude-code backend: unsupported thinkingLevel '${level}' (fail-closed)`);
}

export function createClaudeCodeBackend(opts: ClaudeCodeBackendOpts): AgentBackend {
  return new ClaudeCodeBackend(opts);
}
