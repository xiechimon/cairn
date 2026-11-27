import type { AssistantMessage, Message, ToolResultMessage } from '@earendil-works/pi-ai';
import { defineExtension, type Extension, GenerationTask, hook } from '@earendil-works/pi-durable';
import {
  ANTHROPIC_LONG_TTL_MS,
  ANTHROPIC_SHORT_TTL_MS,
  resolveCacheRetentionTier,
} from './cold-slim.js';

const SILENCE_TOOL_THRESHOLD = 4;
const SILENCE_ELAPSED_MS = 12_000;

const REMINDER_INTERJECTION = [
  '<system_reminder>',
  'The user sent a new message while you are working. Read it and address it first at this step:',
  '1) If they cancel earlier work, stop pursuing it and confirm briefly.',
  '2) If they replace or redirect what you were doing, switch to the updated target immediately.',
  '3) If it is a side question or quick note while earlier work should finish, answer it briefly first (plain text or notify_user omitting provenance) and then continue the remaining work.',
  '</system_reminder>',
].join(' ');

const REMINDER_SILENCE = [
  '<system_reminder>',
  'You have run multiple tool steps without sending a user-facing reply or update.',
  'Briefly tell the user what you are checking now via notify_user (omit provenance in user turns), or answer directly if you already have enough to reply, before running further tools.',
  '</system_reminder>',
].join(' ');

interface InjectedEntry {
  source: string;
  reminder: string;
}

interface TrackerState {
  active: boolean;
  interactive: boolean;
  mailTurn: boolean;
  turnStartIndex: number | null;
  turnStartJson: string | null;
  lastVisibleAt: number;
  lastCountedVisibleIdx: number;
  lastCountedVisibleJson: string | null;
  cacheEpochAt: number;
  injected: Map<number, InjectedEntry>;
}

export interface TurnFlags {
  interactive: boolean;
  mailTurn: boolean;
}

export interface ResponsivenessTracker {
  beginTurn(conversationId: string, flags: TurnFlags): void;
  endTurn(conversationId: string): void;
  clear(conversationId?: string): void;
  stateOf(conversationId: string): TrackerState;
  markVisible(conversationId: string): void;
  now(): number;
  readonly reuseMs: number;
}

function defaultReuseMs(): number {
  return resolveCacheRetentionTier() === 'long' ? ANTHROPIC_LONG_TTL_MS : ANTHROPIC_SHORT_TTL_MS;
}

function hasNonEmptyText(message: AssistantMessage): boolean {
  return message.content.some((block) => block.type === 'text' && block.text.trim() !== '');
}

function isVisibleAssistant(message: Message): boolean {
  return (
    message.role === 'assistant' && message.stopReason !== 'aborted' && hasNonEmptyText(message)
  );
}

function isSuccessfulVisibleTool(message: Message): message is ToolResultMessage {
  return (
    message.role === 'toolResult' &&
    (message.toolName === 'notify_user' || message.toolName === 'ask_user') &&
    message.isError !== true
  );
}

function appendReminder(message: Message, reminder: string): Message {
  if (message.role === 'user') {
    if (typeof message.content === 'string') {
      return { ...message, content: `${message.content}\n\n${reminder}` };
    }
    return {
      ...message,
      content: [...message.content, { type: 'text', text: `\n\n${reminder}` }],
    };
  }
  if (message.role === 'toolResult') {
    return {
      ...message,
      content: [...message.content, { type: 'text', text: `\n\n${reminder}` }],
    };
  }
  return message;
}

export function createResponsivenessTracker(
  options: { now?: () => number; reuseMs?: number } = {},
): ResponsivenessTracker {
  const clock = options.now ?? Date.now;
  const reuseMs = options.reuseMs ?? defaultReuseMs();
  const states = new Map<string, TrackerState>();

  const ensure = (conversationId: string): TrackerState => {
    let state = states.get(conversationId);
    if (state === undefined) {
      const t = clock();
      state = {
        active: false,
        interactive: false,
        mailTurn: false,
        turnStartIndex: null,
        turnStartJson: null,
        lastVisibleAt: t,
        lastCountedVisibleIdx: -1,
        lastCountedVisibleJson: null,
        cacheEpochAt: t,
        injected: new Map(),
      };
      states.set(conversationId, state);
    }
    return state;
  };

  return {
    now: clock,
    reuseMs,
    stateOf: ensure,
    beginTurn(conversationId, flags) {
      const state = ensure(conversationId);
      const t = clock();
      state.active = true;
      state.interactive = flags.interactive;
      state.mailTurn = flags.mailTurn;
      state.turnStartIndex = null;
      state.turnStartJson = null;
      state.lastVisibleAt = t;
      state.lastCountedVisibleIdx = -1;
      state.lastCountedVisibleJson = null;
    },
    endTurn(conversationId) {
      const state = states.get(conversationId);
      if (state === undefined) return;
      state.active = false;
      state.interactive = false;
      state.mailTurn = false;
      state.turnStartIndex = null;
      state.turnStartJson = null;
      state.lastCountedVisibleIdx = -1;
      state.lastCountedVisibleJson = null;
    },
    clear(conversationId) {
      if (conversationId === undefined) states.clear();
      else states.delete(conversationId);
    },
    markVisible(conversationId) {
      const state = states.get(conversationId);
      if (state === undefined) return;
      state.lastVisibleAt = clock();
    },
  };
}

function findActiveTurnStart(messages: readonly Message[]): number {
  let candidateUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg === undefined) continue;
    if (msg.role === 'user') {
      candidateUser = i;
      continue;
    }
    if (msg.role === 'toolResult') continue;
    if (
      msg.role === 'assistant' &&
      (msg.stopReason === 'toolUse' || msg.stopReason === 'aborted')
    ) {
      continue;
    }
    break;
  }
  if (candidateUser >= 0) return candidateUser;
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  return lastUser >= 0 ? lastUser : Math.max(0, messages.length - 1);
}

export function applyResponsivenessBeforeRequest(
  tracker: ResponsivenessTracker,
  conversationId: string,
  messages: readonly Message[],
): { readonly messages: readonly Message[] } | undefined {
  const state = tracker.stateOf(conversationId);
  const t = tracker.now();
  const next = [...messages];
  let changed = false;

  if (t - state.cacheEpochAt >= tracker.reuseMs) {
    state.injected.clear();
  } else {
    for (const [index, entry] of state.injected.entries()) {
      const prior = next[index];
      if (prior !== undefined && JSON.stringify(prior) === entry.source) {
        next[index] = appendReminder(prior, entry.reminder);
        changed = true;
      } else {
        state.injected.delete(index);
      }
    }
  }
  state.cacheEpochAt = t;

  if (!state.active || state.mailTurn || next.length === 0) {
    return changed ? { messages: next } : undefined;
  }

  const cachedStartMsg = state.turnStartIndex !== null ? messages[state.turnStartIndex] : undefined;
  if (
    state.turnStartIndex === null ||
    state.turnStartIndex >= next.length ||
    cachedStartMsg === undefined ||
    JSON.stringify(cachedStartMsg) !== state.turnStartJson
  ) {
    state.turnStartIndex = findActiveTurnStart(messages);
    const resolvedStartMsg = messages[state.turnStartIndex];
    state.turnStartJson = resolvedStartMsg === undefined ? null : JSON.stringify(resolvedStartMsg);
    state.lastCountedVisibleIdx = -1;
    state.lastCountedVisibleJson = null;
  } else if (state.lastCountedVisibleIdx >= 0) {
    const countedMsg = messages[state.lastCountedVisibleIdx];
    if (
      state.lastCountedVisibleIdx >= next.length ||
      countedMsg === undefined ||
      JSON.stringify(countedMsg) !== state.lastCountedVisibleJson
    ) {
      state.lastCountedVisibleIdx = -1;
      state.lastCountedVisibleJson = null;
    }
  }

  const lastIdx = next.length - 1;
  let workStarted = false;
  let silentToolCalls = 0;

  for (let i = state.turnStartIndex; i <= lastIdx; i++) {
    const raw = messages[i];
    if (raw === undefined) continue;
    if (
      i < lastIdx &&
      ((raw.role === 'assistant' && raw.stopReason !== 'aborted') || raw.role === 'toolResult')
    ) {
      workStarted = true;
    }
    if (isVisibleAssistant(raw)) {
      silentToolCalls = 0;
      continue;
    }
    if (raw.role === 'toolResult') {
      if (isSuccessfulVisibleTool(raw)) {
        silentToolCalls = 0;
        if (i > state.lastCountedVisibleIdx) {
          state.lastCountedVisibleIdx = i;
          state.lastCountedVisibleJson = JSON.stringify(raw);
          state.lastVisibleAt = t;
        }
      } else {
        silentToolCalls += 1;
        if (state.injected.has(i)) silentToolCalls = 0;
      }
    }
  }

  if (!state.injected.has(lastIdx)) {
    const rawLast = messages[lastIdx];
    let reminder: string | null = null;
    if (rawLast?.role === 'user' && workStarted) {
      reminder = REMINDER_INTERJECTION;
    } else if (
      rawLast?.role === 'toolResult' &&
      state.interactive &&
      (silentToolCalls >= SILENCE_TOOL_THRESHOLD ||
        (silentToolCalls >= 1 && t - state.lastVisibleAt >= SILENCE_ELAPSED_MS))
    ) {
      reminder = REMINDER_SILENCE;
    }
    if (reminder !== null && rawLast !== undefined) {
      state.injected.set(lastIdx, { source: JSON.stringify(rawLast), reminder });
      next[lastIdx] = appendReminder(rawLast, reminder);
      changed = true;
    }
  }

  return changed ? { messages: next } : undefined;
}

export function observeResponsivenessAfterResponse(
  tracker: ResponsivenessTracker,
  conversationId: string,
  message: AssistantMessage,
): void {
  const state = tracker.stateOf(conversationId);
  if (!state.mailTurn && message.stopReason !== 'aborted' && hasNonEmptyText(message)) {
    tracker.markVisible(conversationId);
  }
}

export function coordinatorResponsivenessExtension(tracker: ResponsivenessTracker): Extension {
  return defineExtension({
    name: 'cairn-coordinator-responsiveness',
    hooks: [
      hook(GenerationTask, {
        beforeRequest: ({ messages }, api) =>
          applyResponsivenessBeforeRequest(tracker, String(api.conversationId), messages),
        afterResponse: (message, api) => {
          observeResponsivenessAfterResponse(tracker, String(api.conversationId), message);
        },
      }),
    ],
  });
}
