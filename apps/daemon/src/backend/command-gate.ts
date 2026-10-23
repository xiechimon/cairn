// 命令闸：tool_call 阻断缝（#866 T5 落地 → #929 换挂点）。
// 机制（pi-coding-agent 1.0.4 实测）：扩展的 tool_call handler 返回
// {block: true, reason} 即阻断该次调用——agent-loop 把 reason 转成 error tool
// result（模型可见，可照着改道）；放行 = 返回 undefined，执行面零参与（pi
// 内建 bash 原样跑，描述/schema/流式/截断/超时/exit 码全为 pi 原生）。闸以
// inline extension 注册在 DefaultResourceLoader 的 extensionFactories（挂点见
// backend/pi.ts）。所有 MCP 工具调用与 codemode 嵌套调用都过这条管线
// （docs/mcp.md Permissions 节），规则表对它们一体生效（#929 新获覆盖面）。
// 裁决分两层（单真值，不存在"表说一套码做一套"）：
// 1. 调用方自带规则（PermissionRule[]，shared 通用 glob 匹配器）：AMP 式可编
//    程策略，首命中胜出；未命中回落第 2 层（bash 面）或默认放行（其它工具）。
//    规则表是通用工具面（tool 槽任意工具名 / `*`），将来服务端统一下发表即进
//    此层。
// 2. 默认不可逆形态（本文件 DEFAULT_BASH_PATTERNS，段级 token 判定，bash 专属
//    形状）：glob 表达不了"rm 的操作数恰为 /"（`*rm*-rf /*` 会误伤 /tmp），
//    精确判定必须做 token 级，见各 pattern 注释。匹配严格度按 base rate 定：
//    rm 普通路径是 agent 日常（worktree 清理）→ 精确到根才拦；mkfs/dd→/dev/
//    断电/fork 在 agent 流量里几乎恒无合法用 → 宁可误拦（一次可改道的拒绝）
//    不漏放。
// ask 在无人值守 daemon 面的执行语义 = 拒（附改道文案）。表里保留 ask 与
// reject 的区分：ask = "有人在场就可批"，reject = "恒无合法用途"（fork 炸弹）；
// 将来审批面（web UI）上线，ask 直接转人工，数据面零迁移。人的判断今天仍在
// confirm（方案审批）/review（改后审计）两道流程闸。
// 威胁模型 = agent 失误，不是恶意 agent：引号剥离 + 分段扫描防的是"好心写错"
// （echo 里提一句 rm -rf / 不该炸），变量展开/转义/编码绕行不在射程内（防误
// 不防恶）。claude-code 后端仍跑 bypassPermissions（钩子在 bypass 下是否触发
// 未验证，动 permissionMode 是全量行为变更，留给后续票），缺口见 PR 与报告。

import { matchPermissionRule, type PermissionAction, type PermissionRule } from '@cairn/shared';
import {
  isToolCallEventType,
  type ToolCallEvent,
  type ToolCallEventResult,
} from '@earendil-works/pi-coding-agent';

export type { PermissionRule };

/** 裁决（ruleId 缺席 = 默认放行；表裁决 ask 与执行动作的区分：tracer 面两者
 * 同值，审批面上线后 ask 可转人工而不改表）。 */
export interface GateDecision {
  action: PermissionAction;
  ruleId?: string;
}

/** 默认不可逆形态（输入 = 已剥引号文本；scope 决定按整串还是按分段判定）。 */
export interface BashGatePattern {
  id: string;
  action: PermissionAction;
  description: string;
  /** 整串 scope 专给跨管道符的形态（fork 炸弹含 `|`，分段会把它拆散）。 */
  scope: 'command' | 'segment';
  test: (text: string, segment: BashSegment) => boolean;
}

/** 分段 token 视图（sudo/env 等前缀已剥，head = 实际命令头）。 */
export interface BashSegment {
  /** 剥前缀后的头 token（如 `sudo rm` → `rm`）。 */
  head: string;
  /** 头之后 token（含 flag 与操作数，`--` 之后全算操作数）。 */
  args: string[];
  /** 分段原文（剥引号后；供 dd 的 of=/dev 这类跨 token 判定）。 */
  text: string;
}

/** 剥前缀链：sudo / env KV… / command / nice（可重复，`sudo env FOO=1 X`）。 */
const PREFIX_TOKENS = new Set(['sudo', 'command', 'nice', 'nohup']);

function tokenize(segmentText: string): BashSegment {
  const raw = segmentText
    .trim()
    .split(/\s+/)
    .filter((t) => t !== '');
  const tokens = [...raw];
  while (tokens.length > 0) {
    const head = tokens[0] as string;
    if (PREFIX_TOKENS.has(head)) {
      tokens.shift();
      continue;
    }
    if (head === 'env') {
      tokens.shift();
      while (tokens.length > 0 && (tokens[0] as string).includes('=')) tokens.shift();
      continue;
    }
    break;
  }
  const [head = '', ...args] = tokens;
  return { head, args, text: segmentText.trim() };
}

/** rm 递归 flag（-r/-R/--recursive，合并短 flag 如 -rf/-fr 亦中）。 */
function hasRecursiveFlag(args: string[]): boolean {
  return args.some(
    (t) =>
      t === '--recursive' ||
      (t.startsWith('-') && t !== '-' && !t.startsWith('--') && /[rR]/.test(t.slice(1))),
  );
}

/** `${NAME}` / `${NAME}/…` → `$NAME` / `$NAME/…`（花括号只是 shell 取值写
 * 法，不改变指代；归一后下游只查 `$` 形。用模板字面量拼，避免
 * noTemplateCurlyInString 误报 shell 字面量）。 */
function normalizeBracedVar(op: string): string {
  const m = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}(\/.*)?$/.exec(op);
  if (!m) return op;
  return `$${m[1] ?? ''}${m[2] ?? ''}`;
}

/** rm 操作数（flag 不算；`--` 之后全算操作数；`${HOME}` 归一成 `$HOME`）。 */
function rmOperands(args: string[]): string[] {
  const out: string[] = [];
  let restAreOperands = false;
  for (const t of args) {
    if (restAreOperands) {
      out.push(normalizeBracedVar(t));
      continue;
    }
    if (t === '--') {
      restAreOperands = true;
      continue;
    }
    if (t.startsWith('-') && t !== '-') continue;
    out.push(normalizeBracedVar(t));
  }
  return out;
}

const POWER_HEADS = new Set(['shutdown', 'reboot', 'halt', 'poweroff']);

/** 默认不可逆形态表（顺序 = 裁决优先序：reject 在前；同为 ask 按表中序）。 */
export const DEFAULT_BASH_PATTERNS: readonly BashGatePattern[] = [
  {
    id: 'reject-forkbomb',
    action: 'reject',
    description: 'fork 炸弹（匿名函数自管道：恒无合法用途，直接拒）',
    scope: 'command',
    test: (text) => text.includes(':()') && text.includes('&') && text.includes('{'),
  },
  {
    id: 'ask-rm-rf-root',
    action: 'ask',
    description: '递归删且目标为系统根（/、/*）或显式关掉 --preserve-root',
    scope: 'segment',
    test: (_text, s) =>
      s.head === 'rm' &&
      hasRecursiveFlag(s.args) &&
      (s.args.includes('--no-preserve-root') ||
        rmOperands(s.args).some((op) => op === '/' || op === '/*')),
  },
  {
    id: 'ask-rm-rf-home',
    action: 'ask',
    description: '递归删且目标为用户家目录（~、$HOME、/root）',
    scope: 'segment',
    test: (_text, s) =>
      s.head === 'rm' &&
      hasRecursiveFlag(s.args) &&
      rmOperands(s.args).some(
        (op) =>
          op === '~' ||
          op === '~/' ||
          op === '$HOME' ||
          op === '/root' ||
          op === '/root/' ||
          op.startsWith('$HOME/') ||
          op.startsWith('/root/'),
      ),
  },
  {
    id: 'ask-mkfs',
    action: 'ask',
    description: '文件系统格式化（恒无合法 agent 用途）',
    scope: 'segment',
    test: (_text, s) => s.head === 'mkfs' || s.head.startsWith('mkfs.'),
  },
  {
    id: 'ask-dd-disk',
    action: 'ask',
    description: 'dd 直写块设备（of=/dev/…；of=/dev/null 是空洞放行）',
    scope: 'segment',
    test: (_text, s) =>
      s.head === 'dd' && s.text.includes('of=/dev/') && !s.text.includes('of=/dev/null'),
  },
  {
    id: 'ask-power',
    action: 'ask',
    description: '关机/重启（执行机是共享/远端资产，停机不可逆）',
    scope: 'segment',
    test: (_text, s) => POWER_HEADS.has(s.head),
  },
];

/** 剥单/双引号包住的 span（echo "rm -rf /" 这类字面提及不判；反引号不剥——
 * 反引号内是真执行，剥了会漏。unmatched 引号剥到行尾：宁可宽（威胁模型非恶
 * 意）。 */
export function stripQuotedSpans(command: string): string {
  let out = '';
  let i = 0;
  while (i < command.length) {
    const ch = command[i];
    if (ch === "'" || ch === '"') {
      const end = command.indexOf(ch, i + 1);
      i = end === -1 ? command.length : end + 1;
      out += ' ';
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

/** 分段（;/&&/||/换行/单竖线；`||` 先于 `|` 切，避免把或拆成管）。 */
export function splitBashSegments(command: string): string[] {
  return command
    .split(/&&|\|\||;|\n|\|/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/** bash 命令裁决：自带表（整串 glob，AMP 式）优先，默认形态（分段 token）
 * 次之，都未中 = 默认放行。Bash 工具名大小写两形（pi `bash` / SDK `Bash`）
 * 都查——自带表写任一形都生效。 */
export function decideBashCommand(
  command: string,
  customRules?: readonly PermissionRule[],
): GateDecision {
  const stripped = stripQuotedSpans(command);
  if (customRules !== undefined) {
    const params = { command: stripped };
    const hit =
      matchPermissionRule(customRules, 'bash', params) ??
      matchPermissionRule(customRules, 'Bash', params);
    if (hit !== undefined) return { action: hit.action, ruleId: hit.id };
  }
  for (const pattern of DEFAULT_BASH_PATTERNS) {
    if (pattern.scope === 'command') {
      if (pattern.test(stripped, { head: '', args: [], text: stripped })) {
        return { action: pattern.action, ruleId: pattern.id };
      }
      continue;
    }
    for (const segmentText of splitBashSegments(stripped)) {
      const segment = tokenize(segmentText);
      if (segment.head === '') continue;
      if (pattern.test(stripped, segment)) return { action: pattern.action, ruleId: pattern.id };
    }
  }
  return { action: 'allow' };
}

/** 拒绝动作档文案（bash/tool 两面共享；ask 在无人值守面 = 拒，reject = 恒拒
 * ——档位语义见表头注）。 */
function refusalActionNote(action: PermissionAction): string {
  return action === 'reject'
    ? 'rejected outright (this shape is never legitimate)'
    : 'requires approval, and this daemon runs unattended (no approval surface), so it is denied';
}

/** 拒绝文案（进 tool result：agent 照着改道；规则 id 供人审计）。 */
export function formatGateRefusal(command: string, decision: GateDecision): string {
  const ruleId = decision.ruleId ?? 'unknown';
  return [
    `command gate (${ruleId}): ${refusalActionNote(decision.action)}.`,
    `command: ${command}`,
    'replan without the irreversible shape (narrow the paths, drop the flags), or put the rationale in the plan and let a human approve it at the confirm/review gate.',
  ].join('\n');
}

/** 门控 operations 退役说明（#929）：原「包 operations.exec 抛拒绝」的缝已删
 * ——阻断改在 tool_call handler（下方 gateToolCallHandler），执行面回到 pi 内
 * 建 bash 原生（超时/取消/截断/流式全为 pi 行为，闸不再复制）。 */

/** 非 bash 工具调用的规则表裁决（#929 覆盖面：MCP 工具 `mcp__*`、resource
 * 工具、内建读面——与 bash 同一张 PermissionRule 表、同一个匹配器；首命中胜
 * 出，未命中 / 无表 = undefined（默认放行）。非 bash 无默认形态表
 * （DEFAULT_BASH_PATTERNS 是 bash 命令形状，不适用于参数面）。参数槽取字符串
 * 值匹配（非字符串/缺席按空串——与 bash 面缺席槽同律）。 */
export function decideToolCall(
  toolName: string,
  params: Readonly<Record<string, unknown>>,
  customRules?: readonly PermissionRule[],
): GateDecision | undefined {
  if (customRules === undefined || customRules.length === 0) return undefined;
  const slots: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    slots[key] = typeof value === 'string' ? value : '';
  }
  const hit = matchPermissionRule(customRules, toolName, slots);
  if (hit === undefined) return undefined;
  return { action: hit.action, ruleId: hit.id };
}

/** 工具面拒绝文案（bash 面同族：规则 id 供人审计 + 改道指引；「command」位
 * 换成被闸的工具名）。 */
export function formatToolRefusal(toolName: string, decision: GateDecision): string {
  const ruleId = decision.ruleId ?? 'unknown';
  return [
    `tool gate (${ruleId}): ${refusalActionNote(decision.action)}.`,
    `tool: ${toolName}`,
    'replan without the gated tool call, or put the rationale in the plan and let a human approve it at the confirm/review gate.',
  ].join('\n');
}

/** tool_call 阻断 handler（#929 挂点；pi.ts 以 inline extension 注册进
 * extensionFactories）。bash 面 = 全量裁决（规则表 + DEFAULT_BASH_PATTERNS）；
 * 其它工具（含 MCP）= 规则表裁决。非放行 → {block, reason}（pi 转成 error
 * tool result，模型可见改道文案）；放行 → undefined（执行面零参与）。
 * 无人值守（F4）：签名只有 event——拒绝路径不依赖 ctx.ui 之类交互确认。
 * allow 静默（非常态不征税）；ask/reject 落一行 gate 日志（审计口径）。 */
export function gateToolCallHandler(opts: {
  rules?: readonly PermissionRule[];
  log?: (msg: string) => void;
}): (event: ToolCallEvent) => Promise<ToolCallEventResult | undefined> {
  const rules = opts.rules;
  const log = opts.log;
  return async (event) => {
    if (isToolCallEventType('bash', event)) {
      const decision = decideBashCommand(event.input.command, rules);
      if (decision.action !== 'allow') {
        log?.(`${decision.action}: rule=${decision.ruleId} command=${event.input.command}`);
        return { block: true, reason: formatGateRefusal(event.input.command, decision) };
      }
      return undefined;
    }
    const hit = decideToolCall(event.toolName, event.input, rules);
    if (hit !== undefined && hit.action !== 'allow') {
      log?.(`${hit.action}: rule=${hit.ruleId} tool=${event.toolName}`);
      return { block: true, reason: formatToolRefusal(event.toolName, hit) };
    }
    return undefined;
  };
}
