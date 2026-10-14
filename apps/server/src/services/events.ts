// team stream 事件 hub（02 §1.2 + r5 §7.2 实测形状）。
// 通道载荷词表单源 = shared teamStreamEventSchema：
// - {"type":"ping","seq":n} ~15s 心跳（r3 §8.1）
// - {"type":"todo"|"build",seq,v,doc} 全文档推送（r5 §7.2；seq = 连接内递增
//   序号，v = 记录版本号）
// - {"type":"notification",notification} 通知事件（r5 §7.2 原样，无 seq/v 位）
// - machine_presence 事件面归 M3（hub 通道已具备）。
// SSE 写入按连接串行化（promise 链），避免交错。

import type {
  BranchSyncRecord,
  BuildRecord,
  ConversationStepEvent,
  NotificationRecord,
  StepActivity,
  TodoRecord,
  TranscriptRow,
} from '@pacman/shared';

/** 单条 SSE 连接的写入口；seq 由 hub 按连接分配。 */
export interface TeamStreamConnection {
  nextSeq(): number;
  /** 写一条已成型事件对象（JSON 序列化后作为 SSE data）。 */
  send(payload: object): Promise<void>;
}

export class TeamStreamHub {
  private readonly byTeam = new Map<string, Set<TeamStreamConnection>>();

  subscribe(teamId: string, conn: TeamStreamConnection): () => void {
    let set = this.byTeam.get(teamId);
    if (!set) {
      set = new Set();
      this.byTeam.set(teamId, set);
    }
    set.add(conn);
    return () => {
      set?.delete(conn);
      if (set && set.size === 0) this.byTeam.delete(teamId);
    };
  }

  subscriberCount(teamId: string): number {
    return this.byTeam.get(teamId)?.size ?? 0;
  }

  /** todo 全文档事件（r5 §7.2：{type:"todo",seq,v,doc}）。 */
  publishTodoDoc(teamId: string, doc: TodoRecord): void {
    this.publish(teamId, (conn) => ({ type: 'todo', seq: conn.nextSeq(), v: doc.v, doc }));
  }

  /** build 全文档事件（r5 §7.2：{type:"build",seq,v,doc}；build 记录无 v 字段，
   * 事件版本位取 1 [推断]——观测样本 v 值未随 build doc 采齐）。 */
  publishBuildDoc(teamId: string, doc: BuildRecord): void {
    this.publish(teamId, (conn) => ({ type: 'build', seq: conn.nextSeq(), v: 1, doc }));
  }

  /** notification 事件（r5 §7.2 原样：{type:"notification",notification:{…}}，
   * 观测形状无 seq/v 位——不消耗连接序号）。三事件触发矩阵与站内未读联动见
   * services/notifications.ts。 */
  publishNotification(teamId: string, record: NotificationRecord): void {
    this.publish(teamId, () => ({ type: 'notification', notification: record }));
  }

  /** branch_sync 事件（M7 #319，08 册附录 B「分支同步」）：
   * {type:"branch_sync", sync:{…}} 全行载荷（status 字段 4 态：
   * pending/running/synced/failed；web 端结果卡按此状态显示「正在同步…/
   * 已同步/失败」三面过渡）。无 seq/v 位——状态机过渡态，载荷真值即契约；
   * web 端订阅即直更 + 重取兜底（02 §1.2/§1.3 双保险）。 */
  publishBranchSync(teamId: string, record: BranchSyncRecord): void {
    this.publish(teamId, () => ({ type: 'branch_sync', sync: record }));
  }

  /** 通用发布：每连接独立组帧（seq 连接内递增）。 */
  publish(teamId: string, frame: (conn: TeamStreamConnection) => object): void {
    const set = this.byTeam.get(teamId);
    if (!set) return;
    for (const conn of set) {
      void conn.send(frame(conn));
    }
  }
}

/** 串行化包装：Hono SSE stream 的 write 按序落盘。 */
export function createSerialConnection(
  write: (payload: object) => Promise<void>,
): TeamStreamConnection {
  let seq = 0;
  let tail: Promise<void> = Promise.resolve();
  return {
    nextSeq: () => ++seq,
    send(payload) {
      tail = tail.then(() => write(payload)).catch(() => {});
      return tail;
    },
  };
}

// —— conversation stream hub（GET /api/conversations/{id}/stream，02 §1.2 会话
// 流；事件词表单源 = shared conversationStreamEventSchema [推断] 定型四事件）。
// 键 = conversationId（build 会话 = buildId；chief 会话 = chief-<threadId>，
// buildId ≡ conversationId 等式两翼同用）。text_delta 为瞬态转发不落库
// （终稿经 transcript 上传兜底，02 §1.3）。
//
// #740 中途进场补发：hub 为每个会话维护「在飞段」文本缓冲（瞬态内存，server
// 重启即丢——契约不变）。订阅建立即把缓冲作为一条 text_delta 补发：中途进场
// 的观众（#640「开始任务」→ toast → 点「查看会话」开抽屉时回合已在飞）看到
// 已流出文本一次性补齐，随后增量照常。缓冲语义 = 镜像 web liveTextStore：
// 任何 message 行落库即清（终稿/工具行/用户行同律——打字面与落库行收敛后，
// 补发给晚进场者只会叠成双份）；步终态（done/failed/stopped）即清；rewind
// 显式清。字节上限保尾弃头、会话数上限 LRU 驱逐（daemon 中途死亡留下的孤儿
// 缓冲由下一回合的用户行清 + LRU 兜底，chief 另有失联 sweep 的 failed 步终态）。

/** 在飞段缓冲 per-conv 字节上限（保尾弃头；128KiB ≈ 4 万 CJK 字，远超单段
 * 助手消息的常态长度，截断只发生在病态长段上）。 */
export const CONV_TEXT_BUFFER_MAX_BYTES = 128 * 1024;

/** 在飞段缓冲会话数上限（超过即驱逐最旧；× 128KiB = 16MiB 硬顶）。 */
export const CONV_TEXT_BUFFER_MAX_CONVS = 128;

export class ConversationStreamHub {
  private readonly byConv = new Map<string, Set<TeamStreamConnection>>();
  /** 在飞段文本缓冲（conversationId → 自上一条落库行以来的增量拼接）。 */
  private readonly textBuffers = new Map<string, string>();
  /** 在飞思考段（#1308）。与 textBuffers 分开：思考行只清自己；assistant
   *  文本行只清正文与活动相位——封段时 runner 先推进新的思考增量，再上报被
   *  封的正文行，一起清会抹掉晚订阅要补的思考快照。用户行、步终态、rewind
   *  仍全文清。 */
  private readonly thinkingBuffers = new Map<string, string>();
  /** 每会话最后一份步活动相位（#905，瞬态单槽）：订阅进场补发用，步终态
   *  即清。LRU 上限与 textBuffers 同值（delete+set 触碰序）。 */
  private readonly lastActivity = new Map<string, StepActivity>();

  subscribe(conversationId: string, conn: TeamStreamConnection): () => void {
    let set = this.byConv.get(conversationId);
    if (!set) {
      set = new Set();
      this.byConv.set(conversationId, set);
    }
    set.add(conn);
    // 进场补发：一条 text_delta 携带当前段快照（经 createSerialConnection 的
    // 串行链先于路由的首帧 ping 落地；web 侧订阅即清旧缓冲，见 sse.ts）。
    const buffered = this.textBuffers.get(conversationId);
    if (buffered !== undefined && buffered !== '') {
      void conn.send({ type: 'text_delta', text: buffered });
    }
    const thinking = this.thinkingBuffers.get(conversationId);
    if (thinking !== undefined && thinking !== '') {
      void conn.send({ type: 'thinking_delta', text: thinking });
    }
    // 活动相位同律补发（#905）：断线重连 / 换页进场立即拿到在跑步的当前
    // 相位，不用等下一次相位变化。
    const activity = this.lastActivity.get(conversationId);
    if (activity !== undefined) {
      void conn.send({ type: 'activity', activity });
    }
    return () => {
      set?.delete(conn);
      if (set && set.size === 0) this.byConv.delete(conversationId);
    };
  }

  subscriberCount(conversationId: string): number {
    return this.byConv.get(conversationId)?.size ?? 0;
  }

  /** transcript 行落库推送（live 工具行 / 终稿行 / 用户行同事件）。 */
  publishMessage(conversationId: string, message: TranscriptRow): void {
    // 段界律（#955 / ADR 0011 D7）：**只有 assistant 文本行**终结当前打字段。
    // 旧律「任何落库行都清」在工具行上会出事——工具行的上报带 500ms/2000ms
    // 重试链，可能迟到，一次迟到就把正在流的下一段抹掉；且 web 侧 #857 起已
    // 是只认 assistant 文本行的 handoff，两侧改到同律镜像才重新成立。
    // 思考缓冲不跟这次全文清（#1308）：thinking_delta 把上一段正文封掉时，
    // runner 先 flush 新思考增量，再上报那条正文行。全文清会丢掉刚写入的
    // 快照，晚订阅只剩相位标签。思考段行自己清思考缓冲；用户行 / system 行
    // 仍清（回合边界）；步终态与 rewind 走 clearConversationBuffer。
    if (endsLiveTextBuffer(message)) {
      this.textBuffers.delete(conversationId);
      this.lastActivity.delete(conversationId);
      if (message.role !== 'assistant') this.thinkingBuffers.delete(conversationId);
    } else if (isThinkingOnlyRow(message.content)) {
      this.thinkingBuffers.delete(conversationId);
    }
    this.publish(conversationId, { type: 'message', message });
  }

  /** pi text_delta 节流批量转发（瞬态，不落库；顺手累积进在飞段缓冲）。 */
  publishTextDelta(conversationId: string, text: string): void {
    if (text === '') return;
    const next = tailWithinBytes(
      (this.textBuffers.get(conversationId) ?? '') + text,
      CONV_TEXT_BUFFER_MAX_BYTES,
    );
    // delete+set = LRU 触碰（Map 尾 = 最新）；超限驱逐最旧。
    this.textBuffers.delete(conversationId);
    this.textBuffers.set(conversationId, next);
    if (this.textBuffers.size > CONV_TEXT_BUFFER_MAX_CONVS) {
      const oldest = this.textBuffers.keys().next().value;
      if (oldest !== undefined) this.textBuffers.delete(oldest);
    }
    this.publish(conversationId, { type: 'text_delta', text });
  }

  /** thinking_delta 节流批量转发（#1308）。瞬态，不落库；累积进思考段缓冲
   *  供晚订阅补发。空文本不发。 */
  publishThinkingDelta(conversationId: string, text: string): void {
    if (text === '') return;
    const next = tailWithinBytes(
      (this.thinkingBuffers.get(conversationId) ?? '') + text,
      CONV_TEXT_BUFFER_MAX_BYTES,
    );
    this.thinkingBuffers.delete(conversationId);
    this.thinkingBuffers.set(conversationId, next);
    if (this.thinkingBuffers.size > CONV_TEXT_BUFFER_MAX_CONVS) {
      const oldest = this.thinkingBuffers.keys().next().value;
      if (oldest !== undefined) this.thinkingBuffers.delete(oldest);
    }
    this.publish(conversationId, { type: 'thinking_delta', text });
  }

  /** 步活动相位（#905）：daemon 上报经 reportActivity 盖章后瞬态转发；
   *  单槽留最后一份供订阅补发。 */
  publishActivity(conversationId: string, activity: StepActivity): void {
    this.lastActivity.delete(conversationId);
    this.lastActivity.set(conversationId, activity);
    if (this.lastActivity.size > CONV_TEXT_BUFFER_MAX_CONVS) {
      const oldest = this.lastActivity.keys().next().value;
      if (oldest !== undefined) this.lastActivity.delete(oldest);
    }
    this.publish(conversationId, { type: 'activity', activity });
  }

  /** 步状态流转（pending/claimed/done/failed/stopped）。 */
  publishStep(conversationId: string, step: ConversationStepEvent['step']): void {
    // 终态 = 回合/步终局（终稿行通常先行落库，此为兜底；stopped/failed 无终稿
    // 上传时唯一清空点）。claimed/pending 是回合进行中——不清。
    if (step.status === 'done' || step.status === 'failed' || step.status === 'stopped') {
      this.clearConversationBuffer(conversationId);
    }
    this.publish(conversationId, { type: 'step', step });
  }

  /** rewind / 线程重置通道：显式清空在飞段缓冲（状态失步防御）。活动单槽
   *  同清（#905）：终局/重置后不得再向进场订阅补发死相位。 */
  clearConversationBuffer(conversationId: string): void {
    this.textBuffers.delete(conversationId);
    this.thinkingBuffers.delete(conversationId);
    this.lastActivity.delete(conversationId);
  }

  publish(conversationId: string, payload: object): void {
    const set = this.byConv.get(conversationId);
    if (!set) return;
    for (const conn of set) {
      void conn.send(payload);
    }
  }
}

/** 落库行是否终结在飞文本缓冲（#955 / ADR 0011 D7）。**只排除两种行**：
 *  工具行——它的上报带 500ms/2000ms 重试链、可能迟到，一次迟到就把正在流的
 *  下一段抹掉；仅思考行——思考内容从不进文本缓冲，清它只会误伤同窗的正文。
 *  其余（用户行、assistant 文本行、system 行）照旧终结缓冲：用户行是回合
 *  边界（也是 #740 那条「终态缺失的死回合由下一回合用户行兜底清」的守卫），
 *  assistant 文本行是段界。 */
function endsLiveTextBuffer(message: TranscriptRow): boolean {
  return !isToolCallRow(message.content) && !isThinkingOnlyRow(message.content);
}

/** content 是否为 live 工具行（`{kind:'toolcall', call}`）。 */
function isToolCallRow(content: unknown): boolean {
  return (
    content !== null &&
    typeof content === 'object' &&
    !Array.isArray(content) &&
    (content as { kind?: unknown }).kind === 'toolcall'
  );
}

/** content 是否为「仅思考」块数组（#955 段行形；存量原始块数组若混了 text
 *  则不算——那行走正文面，缓冲该清）。 */
function isThinkingOnlyRow(content: unknown): boolean {
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.every(
    (block) =>
      block !== null &&
      typeof block === 'object' &&
      (block as { type?: string }).type === 'thinking',
  );
}

/** 保尾弃头截断：取字节上限内的最长尾部后缀（二分后缀长；截断边界可能劈裂
 * 代理对——剥掉孤立低位代理，补发文本不得以半个字符开头）。 */
function tailWithinBytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text) <= maxBytes) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (Buffer.byteLength(text.slice(text.length - mid)) <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  const suffix = text.slice(text.length - lo);
  const first = suffix.charCodeAt(0);
  return first >= 0xdc00 && first <= 0xdfff ? suffix.slice(1) : suffix;
}
