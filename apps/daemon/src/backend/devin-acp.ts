import type { SessionUpdate } from '@agentclientprotocol/sdk';

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export interface DevinNormalizedUpdate {
  update: SessionUpdate | null;
  parent?: string;
}

export function createDevinUpdateNormalizer(): (update: SessionUpdate) => DevinNormalizedUpdate {
  const agentToolCalls = new Map<string, string>();
  return (update: SessionUpdate): DevinNormalizedUpdate => {
    const meta = record(update._meta);
    const context = record(meta?.['cognition.ai/subagent_context']);
    const rawParent =
      typeof context?.parentAgentId === 'string' && context.parentAgentId !== 'root'
        ? context.parentAgentId
        : undefined;
    const kind = update.sessionUpdate;
    if (kind === 'agent_message_chunk' || kind === 'agent_thought_chunk') {
      return { update: rawParent === undefined ? update : null };
    }
    if (kind !== 'tool_call' && kind !== 'tool_call_update') return { update };
    const started = record(meta?.['cognition.ai/subagent_started']);
    const startedAgentId = typeof started?.agentId === 'string' ? started.agentId : undefined;
    if (startedAgentId !== undefined && 'toolCallId' in update) {
      agentToolCalls.set(startedAgentId, update.toolCallId);
    }
    const parent = rawParent !== undefined ? (agentToolCalls.get(rawParent) ?? rawParent) : undefined;
    let next = update;
    const completed = record(meta?.['cognition.ai/subagent_completed']);
    const inference = meta?.['cognition.ai/inferenceToolName'];
    if (typeof started?.title === 'string') {
      next = { ...next, title: `Subagent: ${started.title}` } as SessionUpdate;
    } else if (typeof inference === 'string' && (next.title === undefined || next.title === 'Tool')) {
      next = { ...next, title: inference } as SessionUpdate;
    }
    if (completed !== undefined) {
      const summary = typeof completed.summary === 'string' ? completed.summary : null;
      next = {
        ...next,
        status: completed.success === false ? 'failed' : 'completed',
        ...(summary !== null
          ? { content: [{ type: 'content', content: { type: 'text', text: summary } }] }
          : {}),
      } as SessionUpdate;
    }
    return { update: next, ...(parent !== undefined ? { parent } : {}) };
  };
}
