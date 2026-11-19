type Block = { readonly type?: unknown; readonly [key: string]: unknown };

type PayloadMessage = { readonly role: string; readonly content: unknown };

interface AnthropicPayload {
  readonly system?: unknown;
  readonly tools?: unknown;
  readonly messages: readonly PayloadMessage[];
}

interface Position {
  message: number;
  block: number;
}

interface SentMessage {
  role: string;
  blocks: string[];
  ids: (string | undefined)[];
}

interface Sent {
  head: string;
  messages: SentMessage[];
  dropped: Set<string>;
}

const BINDING_ERROR =
  /messages\.(\d+)\.content\.(\d+): Invalid `[a-z_]+` in `(?:redacted_)?thinking` block\. The block is bound to a different conversation/;
const FIRST_CHANGE = /first at `messages\.(\d+)\.content\.(\d+)`/;
const HEAD_CHANGE = /The `(?:system|tools)`/;

export interface ThinkingBindingGuard {
  apply<T>(key: string, payload: T): T;
  reject(key: string, errorMessage: string): boolean;
}

export function createThinkingBindingGuard(): ThinkingBindingGuard {
  const sent = new Map<string, Sent>();
  return {
    apply: (key, payload) => {
      if (!isAnthropicPayload(payload)) return payload;
      const previous = sent.get(key);
      const dropped = previous?.dropped ?? new Set<string>();
      const head = canonical({ system: payload.system, tools: payload.tools });
      const visible = payload.messages.map((message) =>
        blocksOf(message.content).filter((block) => !dropped.has(bindingId(block) ?? '')),
      );
      const cut =
        previous === undefined
          ? null
          : previous.head !== head
            ? { message: 0, block: 0 }
            : firstChange(previous.messages, payload.messages, visible);
      const kept = visible.map((blocks, message) =>
        blocks.filter((block, at) => {
          const id = bindingId(block);
          if (id === undefined || cut === null || before({ message, block: at }, cut)) return true;
          dropped.add(id);
          return false;
        }),
      );
      const messages = payload.messages.flatMap((message, index) => {
        const blocks = kept[index] ?? [];
        if (blocks.length === blocksOf(message.content).length) return [message];
        if (blocks.length === 0 && message.role === 'assistant') return [];
        return [{ ...message, content: blocks }];
      });
      sent.set(key, {
        head,
        messages: messages.map((message) => {
          const blocks = blocksOf(message.content);
          return { role: message.role, blocks: blocks.map(canonical), ids: blocks.map(bindingId) };
        }),
        dropped,
      });
      return messages.length === payload.messages.length &&
        messages.every((message, index) => message === payload.messages[index])
        ? payload
        : ({ ...payload, messages } as typeof payload);
    },
    reject: (key, errorMessage) => {
      const invalid = BINDING_ERROR.exec(errorMessage);
      const last = sent.get(key);
      if (invalid === null || last === undefined) return false;
      const first = FIRST_CHANGE.exec(errorMessage);
      const cut = HEAD_CHANGE.test(errorMessage)
        ? { message: 0, block: 0 }
        : { message: Number((first ?? invalid)[1]), block: Number((first ?? invalid)[2]) };
      let added = false;
      last.messages.forEach((message, index) => {
        message.ids.forEach((id, block) => {
          if (id === undefined || before({ message: index, block }, cut) || last.dropped.has(id))
            return;
          last.dropped.add(id);
          added = true;
        });
      });
      return added;
    },
  };
}

function before(position: Position, cut: Position): boolean {
  return (
    position.message < cut.message ||
    (position.message === cut.message && position.block < cut.block)
  );
}

function firstChange(
  previous: SentMessage[],
  messages: readonly PayloadMessage[],
  visible: Block[][],
): Position | null {
  for (const [index, sentMessage] of previous.entries()) {
    const message = messages[index];
    const blocks = visible[index];
    if (message === undefined || blocks === undefined) return null;
    if (message.role !== sentMessage.role) return { message: index, block: 0 };
    for (const [block, shape] of sentMessage.blocks.entries()) {
      const current = blocks[block];
      if (current === undefined || canonical(current) !== shape) return { message: index, block };
    }
    if (index < previous.length - 1 && blocks.length !== sentMessage.blocks.length) {
      return { message: index, block: sentMessage.blocks.length };
    }
  }
  return null;
}

function isAnthropicPayload(payload: unknown): payload is AnthropicPayload {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    Array.isArray((payload as { messages?: unknown }).messages)
  );
}

function blocksOf(content: unknown): Block[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return Array.isArray(content) ? (content as Block[]) : [];
}

function bindingId(block: Block): string | undefined {
  if (block.type === 'thinking' && typeof block.signature === 'string' && block.signature !== '')
    return block.signature;
  if (block.type === 'redacted_thinking' && typeof block.data === 'string' && block.data !== '')
    return block.data;
  return undefined;
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (key, inner) => (key === 'cache_control' ? undefined : inner));
}
