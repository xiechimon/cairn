// live 文本增量缓冲（M5 live streaming）：conversation stream 的 text_delta
// 事件按会话累积成「正在打字的助手行」。
//
// #857 收敛交接：message 事件到达 ≠ 落库行可见（messages 重取在飞）——同步
// 清缓冲会把已显示文本闪清，直到重取落地才重现（每轮一次）。故 message 事件
// 只记 handoff（事件瞬间缓冲长度 = 被该落库行覆盖的前缀），缓冲的实际丢弃推
// 迟到消费侧观测到 messages 已含该行（getVisible 切片 / prune 落盘）。服务端
// hub 作镜像语义（任何落库行终结在飞段），客户端只在时序上收敛，不在覆盖面
// 上打折：handoff 只记 assistant 文本行——工具行/用户行到达时前缀尚无落库行
// 覆盖，跟它们收敛会永久丢文本。
// useSyncExternalStore 消费——组件外单例，SSE 回调直写。

type Listener = () => void;

const buffers = new Map<string, string>();
/** 待交接：conversationId → { messageId, prefixLen }。单调单槽——后到的
 *  事件快照更长的前缀，天然覆盖前者（同一次 messages 重取必同时含两者）。 */
const handoffs = new Map<string, { messageId: string; prefixLen: number }>();
/** 2026-10-13 发送黑盒拆除：每个会话最后一次 text_delta 到达的本机时刻——
 *  「安静多久了」的另一半真值（activity.at 只在相位变化时动，响应期的信号
 *  是 delta 流；两时钟取新 = 静默判定不冤枉输出中的模型）。 */
const lastDeltaAt = new Map<string, number>();
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l();
}

export const liveTextStore = {
  append(conversationId: string, text: string): void {
    buffers.set(conversationId, (buffers.get(conversationId) ?? '') + text);
    lastDeltaAt.set(conversationId, Date.now());
    emit();
  },
  /** 终稿行到达：整段缓冲作废（消息重取接管呈现）。 */
  clear(conversationId: string): void {
    const hadBuffer = buffers.delete(conversationId);
    const hadHandoff = handoffs.delete(conversationId);
    const hadDelta = lastDeltaAt.delete(conversationId);
    if (hadBuffer || hadHandoff || hadDelta) emit();
  },
  /** #857：assistant 文本行落库事件——记 handoff，不清缓冲。buffer 为空时
   *  无可交接内容，不记（保持 map 干净）。 */
  noteSettled(conversationId: string, messageId: string): void {
    const buf = buffers.get(conversationId) ?? '';
    if (buf === '') return;
    handoffs.set(conversationId, { messageId, prefixLen: buf.length });
  },
  /** 收敛感知读数（消费侧渲染用，纯函数）：messages 已含 handoff 行 →
   *  返回去掉已覆盖前缀的剩余增量；否则返回全缓冲。 */
  getVisible(conversationId: string, knownIds?: Set<string>): string {
    const buf = buffers.get(conversationId) ?? '';
    const h = handoffs.get(conversationId);
    if (h !== undefined && knownIds?.has(h.messageId) === true) {
      return buf.slice(h.prefixLen);
    }
    return buf;
  },
  /** 收敛落盘（消费侧 messages 变化时调）：handoff 已收敛 → 把前缀从缓冲
   *  里真正丢掉（bound 内存；visible 输出不变，故不 emit、不驱动重渲）。 */
  prune(conversationId: string, knownIds?: Set<string>): void {
    const h = handoffs.get(conversationId);
    if (h === undefined || knownIds?.has(h.messageId) !== true) return;
    const buf = buffers.get(conversationId) ?? '';
    const rest = buf.slice(h.prefixLen);
    if (rest === '') buffers.delete(conversationId);
    else buffers.set(conversationId, rest);
    handoffs.delete(conversationId);
  },
  get(conversationId: string): string {
    return buffers.get(conversationId) ?? '';
  },
  /** 最后一次 text_delta 的本机时刻；从未收到 = null（无增量面不摆数）。 */
  getLastDeltaAt(conversationId: string): number | null {
    return lastDeltaAt.get(conversationId) ?? null;
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
