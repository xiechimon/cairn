import type { Message, ToolResultMessage } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import {
  COLD_CACHE_MISS_MIN_TOKENS,
  COLD_RECENT_EXCHANGES,
  coldWindowStartFromRows,
  isColdResume,
  projectColdMessages,
  retentionMsFor,
  SHORT_RETENTION_MS,
  selectColdMessageWindow,
  stripConsumedImages,
  truncateOldToolResults,
} from '../../src/coordinator/runtime/cold-slim.js';

const user = (text: string, timestamp = 1): Message => ({
  role: 'user',
  content: text,
  timestamp,
});

const assistant = (text: string, timestamp = 1): Message => ({
  role: 'assistant',
  content: [{ type: 'text', text }],
  api: 'anthropic-messages',
  provider: 'anthropic',
  model: 'm',
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: 'stop',
  timestamp,
});

const tool = (name: string, text: string, timestamp = 1): ToolResultMessage => ({
  role: 'toolResult',
  toolCallId: `c-${name}-${timestamp}`,
  toolName: name,
  content: [{ type: 'text', text }],
  isError: false,
  timestamp,
});

describe('isColdResume', () => {
  it('is warm when last turn is fresh with cache hits', () => {
    expect(
      isColdResume({
        now: 10_000,
        retentionMs: SHORT_RETENTION_MS,
        lastUsage: {
          createdAt: 9_000,
          cacheRead: 12_000,
          input: 100,
          contextTokens: 12_100,
          model: 'openai/gpt',
        },
      }),
    ).toBe(false);
  });

  it('is cold after the retention TTL', () => {
    expect(
      isColdResume({
        now: SHORT_RETENTION_MS + 5_000,
        retentionMs: SHORT_RETENTION_MS,
        lastUsage: {
          createdAt: 0,
          cacheRead: 20_000,
          input: 100,
          contextTokens: 20_100,
          model: 'openai/gpt',
        },
      }),
    ).toBe(true);
  });

  it('is cold on a large cache miss inside the TTL', () => {
    expect(
      isColdResume({
        now: 1_000,
        retentionMs: SHORT_RETENTION_MS,
        lastUsage: {
          createdAt: 0,
          cacheRead: 0,
          input: COLD_CACHE_MISS_MIN_TOKENS,
          contextTokens: COLD_CACHE_MISS_MIN_TOKENS,
          model: 'anthropic/claude',
        },
      }),
    ).toBe(true);
  });

  it('ignores empty first turns', () => {
    expect(
      isColdResume({
        now: 1_000,
        retentionMs: SHORT_RETENTION_MS,
        lastUsage: null,
      }),
    ).toBe(false);
  });
});

describe('retentionMsFor', () => {
  it('uses five minutes for the short tier', () => {
    expect(retentionMsFor('short', 'anthropic/claude')).toBe(SHORT_RETENTION_MS);
  });

  it('uses one hour for Anthropic long retention', () => {
    expect(retentionMsFor('long', 'anthropic/claude-opus')).toBe(60 * 60_000);
  });

  it('uses twenty-four hours for OpenAI long retention', () => {
    expect(retentionMsFor('long', 'openai/gpt-5')).toBe(24 * 60 * 60_000);
  });
});

describe('truncateOldToolResults', () => {
  it('keeps the last three tool results whole and shortens earlier ones', () => {
    const long = 'x'.repeat(2_000);
    const messages: Message[] = [
      user('u0'),
      tool('bash', long, 1),
      tool('bash', long, 2),
      tool('tour', long, 3),
      tool('bash', long, 4),
      tool('bash', 'short', 5),
      user('u1'),
    ];
    const out = truncateOldToolResults(messages);
    const tools = out.filter((message) => message.role === 'toolResult');
    expect(tools).toHaveLength(5);
    expect(toolResultChars(tools[0]!).length).toBeLessThan(1_100);
    expect(toolResultChars(tools[0]!)).toContain('shortened');
    expect(toolResultChars(tools[2]!).length).toBe(2_000);
    expect(toolResultChars(tools[4]!).length).toBe(5);
  });

  it('does not shorten read_history results', () => {
    const long = 'y'.repeat(2_000);
    const out = truncateOldToolResults([tool('read_history', long, 1), tool('bash', long, 2)]);
    expect(toolResultChars(out[0]!).length).toBe(2_000);
  });
});

describe('stripConsumedImages', () => {
  it('replaces older image blocks with a pointer note', () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'see' },
          { type: 'image', data: 'aaa', mimeType: 'image/png' },
        ],
        timestamp: 1,
      },
      user('latest'),
    ];
    const out = stripConsumedImages(messages, { keepRecentMessages: 1 });
    expect(out[0]?.role).toBe('user');
    if (out[0]?.role !== 'user' || typeof out[0].content === 'string') throw new Error('shape');
    expect(out[0].content.some((block) => block.type === 'image')).toBe(false);
    expect(
      out[0].content.some((block) => block.type === 'text' && block.text.includes('omitted')),
    ).toBe(true);
  });
});

describe('selectColdMessageWindow', () => {
  it('keeps the last N conversational exchanges and drops wake rows', () => {
    const messages: Message[] = [user('[wake:timer] noise')];
    for (let i = 0; i < COLD_RECENT_EXCHANGES + 4; i++) {
      messages.push(user(`u${i}`), assistant(`a${i}`));
    }
    messages.push(user('current'));
    const out = selectColdMessageWindow(messages);
    const users = out.filter((message) => message.role === 'user').map(userText);
    expect(users.some((text) => text.includes('wake'))).toBe(false);
    expect(users[0]).toBe('u5');
    expect(users.at(-1)).toBe('current');
    expect(users).toHaveLength(COLD_RECENT_EXCHANGES);
  });
});

describe('projectColdMessages', () => {
  it('injects a summary hint when the residual has none', () => {
    const out = projectColdMessages([user('old'), assistant('a'), user('now')], {
      summaryHint: 'prior work on billing',
    });
    expect(out.some((message) => userText(message).includes('<summary>'))).toBe(true);
    expect(out.some((message) => userText(message) === 'now')).toBe(true);
  });
});

describe('coldWindowStartFromRows', () => {
  it('returns the oldest row inside the recent exchange window', () => {
    const newestFirst = [];
    for (let i = 20; i >= 0; i--) {
      newestFirst.push({ at: i * 10, rowid: i, role: i % 2 === 0 ? 'user' : 'assistant' });
    }
    const start = coldWindowStartFromRows(newestFirst, 3);
    expect(start).toEqual({ at: 160, rowid: 16 });
  });
});

function toolResultChars(message: Message): string {
  if (message.role !== 'toolResult') return '';
  return message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n');
}

function userText(message: Message): string {
  if (message.role !== 'user') return '';
  if (typeof message.content === 'string') return message.content;
  return message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n');
}
