import type { Message } from '@earendil-works/pi-ai';
import { defineExtension, GenerationTask, hook } from '@earendil-works/pi-durable';

export interface VolatileContext {
  set(conversationId: string, text: string | null): void;
  get(conversationId: string): string | undefined;
}

export function createVolatileContext(): VolatileContext {
  const sections = new Map<string, string>();
  return {
    set: (conversationId, text) => {
      if (text === null || text === '') sections.delete(conversationId);
      else sections.set(conversationId, text);
    },
    get: (conversationId) => sections.get(conversationId),
  };
}

export function withVolatileSection(messages: readonly Message[], section: string): Message[] {
  const index = messages.findLastIndex((message) => message.role === 'user');
  if (index < 0) return [...messages];
  return messages.map((message, i) => {
    if (i !== index || message.role !== 'user') return message;
    const content =
      typeof message.content === 'string'
        ? `${message.content}\n\n${section}`
        : [...message.content, { type: 'text' as const, text: `\n\n${section}` }];
    return { ...message, content };
  });
}

export function volatileContextExtension(volatile: VolatileContext) {
  return defineExtension({
    name: 'cairn-coordinator-volatile',
    hooks: [
      hook(GenerationTask, {
        beforeRequest: (request, api) => {
          const section = volatile.get(String(api.conversationId));
          if (section === undefined) return undefined;
          return { messages: withVolatileSection(request.messages, section) };
        },
      }),
    ],
  });
}
