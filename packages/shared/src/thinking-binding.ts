type Block = { readonly type?: unknown; readonly [key: string]: unknown };

type PayloadMessage = { readonly role: string; readonly content: unknown };

interface AnthropicPayload {
  readonly system?: unknown;
  readonly tools?: unknown;
  readonly messages: readonly PayloadMessage[];
}

interface Sent {
  head: string;
  messages: { role: string; blocks: string[] }[];
  dropped: Set<string>;
}

export interface ThinkingBindingGuard {
  apply<T>(key: string, payload: T): T;
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
        previous === undefined || previous.head !== head
          ? { message: 0, block: 0 }
          : firstChange(previous.messages, payload.messages, visible);
      const kept = visible.map((blocks, message) =>
        blocks.filter((block, at) => {
          const id = bindingId(block);
          if (id === undefined || cut === null) return true;
          if (message < cut.message || (message === cut.message && at < cut.block)) return true;
          dropped.add(id);
          return false;
        }),
      );
      const messages = payload.messages.flatMap((message, index) => {
        const blocks = kept[index] ?? [];
        const original = blocksOf(message.content);
        if (blocks.length === original.length) return [message];
        if (blocks.length === 0 && message.role === 'assistant') return [];
        return [{ ...message, content: blocks }];
      });
      sent.set(key, {
        head,
        messages: messages.map((message) => ({
          role: message.role,
          blocks: blocksOf(message.content).map(canonical),
        })),
        dropped,
      });
      const unchanged = messages.every((message, index) => message === payload.messages[index]);
      return unchanged && messages.length === payload.messages.length
        ? payload
        : ({ ...payload, messages } as typeof payload);
    },
  };
}

function firstChange(
  previous: Sent['messages'],
  messages: readonly PayloadMessage[],
  visible: Block[][],
): { message: number; block: number } | null {
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
