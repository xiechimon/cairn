import { dropMailFence, shortEvent, transcriptPromptRowId, withHistoryMarker } from '@cairn/shared';
import type { Message } from '@earendil-works/pi-ai';
import { defineExtension, GenerationTask, hook } from '@earendil-works/pi-durable';
import { projectColdMessages, projectWarmMessages } from './cold-slim.js';

export interface ColdSlimPlan {
  cold: boolean;
  summaryHint?: string | null;
}

export interface VolatileContext {
  set(conversationId: string, text: string | null): void;
  get(conversationId: string): string | undefined;
  setStep(conversationId: string, stepId: string | null): void;
  step(conversationId: string): string | undefined;
  setColdSlim(conversationId: string, plan: ColdSlimPlan | null): void;
  coldSlim(conversationId: string): ColdSlimPlan | undefined;
}

export function createVolatileContext(): VolatileContext {
  const sections = new Map<string, string>();
  const steps = new Map<string, string>();
  const coldSlims = new Map<string, ColdSlimPlan>();
  return {
    setStep: (conversationId, stepId) => {
      if (stepId === null) steps.delete(conversationId);
      else steps.set(conversationId, stepId);
    },
    step: (conversationId) => steps.get(conversationId),
    set: (conversationId, text) => {
      if (text === null || text === '') sections.delete(conversationId);
      else sections.set(conversationId, text);
    },
    get: (conversationId) => sections.get(conversationId),
    setColdSlim: (conversationId, plan) => {
      if (plan === null) coldSlims.delete(conversationId);
      else coldSlims.set(conversationId, plan);
    },
    coldSlim: (conversationId) => coldSlims.get(conversationId),
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

function firstText(message: Message): string | null {
  if (message.role !== 'user') return null;
  if (typeof message.content === 'string') return message.content;
  const first = message.content[0];
  return first?.type === 'text' ? first.text : null;
}

function withFirstText(message: Message, text: string): Message {
  if (message.role !== 'user') return message;
  if (typeof message.content === 'string') return { ...message, content: text };
  const [first, ...rest] = message.content;
  return first?.type === 'text' ? { ...message, content: [{ ...first, text }, ...rest] } : message;
}

export function shortenEarlierEvents(
  messages: readonly Message[],
  currentStepId?: string,
): Message[] {
  const latest = messages.findLastIndex((message) => message.role === 'user');
  return messages.map((message, i) => {
    const text = firstText(message);
    if (text === null || i >= latest) return message;
    if (
      currentStepId !== undefined &&
      text.includes(withHistoryMarker('', transcriptPromptRowId(currentStepId)).trim())
    ) {
      return message;
    }
    const short = shortEvent(text);
    return short === null ? message : withFirstText(message, short);
  });
}

export function applyContextProjection(
  messages: readonly Message[],
  plan: ColdSlimPlan | undefined,
): Message[] {
  if (plan?.cold === true) {
    return projectColdMessages(messages, { summaryHint: plan.summaryHint });
  }
  return projectWarmMessages(messages);
}

function dropStoredMailFences(messages: readonly Message[]): Message[] {
  return messages.map((message): Message => {
    if (message.role === 'user' && typeof message.content === 'string') {
      const content = dropMailFence(message.content);
      return content === message.content ? message : { ...message, content };
    }
    if (message.role === 'user' && Array.isArray(message.content)) {
      return {
        ...message,
        content: message.content.map((block) =>
          block.type === 'text' ? { ...block, text: dropMailFence(block.text) } : block,
        ),
      };
    }
    if (message.role === 'assistant') {
      return {
        ...message,
        content: message.content.map((block) =>
          block.type === 'text' ? { ...block, text: dropMailFence(block.text) } : block,
        ),
      };
    }
    if (message.role === 'toolResult') {
      return {
        ...message,
        content: message.content.map((block) =>
          block.type === 'text' ? { ...block, text: dropMailFence(block.text) } : block,
        ),
      };
    }
    return message;
  });
}

export function volatileContextExtension(volatile: VolatileContext) {
  return defineExtension({
    name: 'cairn-coordinator-volatile',
    hooks: [
      hook(GenerationTask, {
        beforeRequest: (request, api) => {
          const conversationId = String(api.conversationId);
          const section = volatile.get(conversationId);
          const shortened = shortenEarlierEvents(request.messages, volatile.step(conversationId));
          const projected = dropStoredMailFences(
            applyContextProjection(shortened, volatile.coldSlim(conversationId)),
          );
          return {
            messages: section === undefined ? projected : withVolatileSection(projected, section),
          };
        },
      }),
    ],
  });
}
