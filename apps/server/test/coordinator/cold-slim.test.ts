import type { Message, ToolResultMessage } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import {
  COLD_CACHE_MISS_MIN_TOKENS,
  COLD_RECENT_EXCHANGES,
  coldWindowStartFromRows,
  imageOmissionNote,
  isColdResume,
  isPureToolCallAssistant,
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
  it('replaces older image blocks with a real attachmentId pointer', () => {
    const token = '![shot.png](attachment:team1/att-abc.png)';
    const messages: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: `see\n\n${token}` },
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
    const note = out[0].content.find(
      (block) => block.type === 'text' && block.text.includes('omitted'),
    );
    expect(note?.type === 'text' ? note.text : '').toBe(
      imageOmissionNote('att-abc', 'team1/att-abc.png'),
    );
  });

  it('falls back when no attachment token is present', () => {
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
    if (out[0]?.role !== 'user' || typeof out[0].content === 'string') throw new Error('shape');
    expect(
      out[0].content.some(
        (block) => block.type === 'text' && block.text.includes('no attachmentId'),
      ),
    ).toBe(true);
  });
});

describe('selectColdMessageWindow', () => {
  it('keeps the last N conversational exchanges and drops earlier wake rows', () => {
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

  it('keeps a current wake prompt while dropping earlier wakes', () => {
    const messages: Message[] = [
      user('[wake:old] stale'),
      assistant('a0'),
      user('[wake:task] Task #3 finished\n[history id: user-abc]'),
    ];
    const out = selectColdMessageWindow(messages);
    const users = out.filter((message) => message.role === 'user').map(userText);
    expect(users.some((text) => text.includes('[wake:old]'))).toBe(false);
    expect(users.at(-1)).toContain('[wake:task]');
    expect(users.at(-1)).toContain('[history id: user-abc]');
  });

  it('drops pure tool-call assistants and their tool results from the cold window', () => {
    const pureTool: Message = {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'ls' } }],
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
      stopReason: 'toolUse',
      timestamp: 2,
    };
    expect(isPureToolCallAssistant(pureTool)).toBe(true);
    const messages: Message[] = [
      user('u0', 1),
      pureTool,
      tool('bash', 'noise', 3),
      user('current', 4),
    ];
    const out = selectColdMessageWindow(messages, 8);
    expect(out.some((message) => message.role === 'assistant')).toBe(false);
    expect(out.some((message) => message.role === 'toolResult')).toBe(false);
    expect(out.filter((message) => message.role === 'user').map(userText)).toEqual([
      'u0',
      'current',
    ]);
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

  it('replaces a stale durable summary when catch-up supplies a newer hint', () => {
    const stale: Message = {
      role: 'user',
      content:
        'Earlier turns were compacted into the following summary:\n\n<summary>\nstale seed</summary>\n\nOlder detail is in the summary, todos, and read_history.',
      timestamp: 1,
    };
    const out = projectColdMessages([stale, user('old'), assistant('a'), user('now')], {
      summaryHint: 'catch-up folded later turns',
    });
    const summaries = out.filter((message) => userText(message).includes('<summary>'));
    expect(summaries).toHaveLength(1);
    expect(userText(summaries[0]!)).toContain('catch-up folded later turns');
    expect(userText(summaries[0]!)).not.toContain('stale seed');
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

describe('idle → miss → slim', () => {
  it('cuts a fat residual to summary + recent exchanges after TTL cold', () => {
    const fat: Message[] = [];
    for (let i = 0; i < 40; i++) {
      fat.push(user(`turn-${i} ${'body '.repeat(200)}`));
      fat.push(assistant(`reply-${i}`));
      fat.push(tool('tour', 'LOG '.repeat(800), i + 1));
      fat.push({
        role: 'user',
        content: [
          { type: 'text', text: `shot-${i}` },
          { type: 'image', data: 'x'.repeat(4_000), mimeType: 'image/png' },
        ],
        timestamp: i + 1,
      });
    }
    fat.push(user('[wake:timer] stale wake noise'));
    fat.push(user('what did we leave open?'));
    const before = JSON.stringify(fat).length;
    expect(
      isColdResume({
        now: SHORT_RETENTION_MS + 1,
        retentionMs: SHORT_RETENTION_MS,
        lastUsage: {
          createdAt: 0,
          cacheRead: 0,
          input: COLD_CACHE_MISS_MIN_TOKENS,
          contextTokens: before,
          model: 'anthropic/claude',
        },
      }),
    ).toBe(true);
    const slim = projectColdMessages(fat, { summaryHint: 'queued billing fix; tour done' });
    const after = JSON.stringify(slim).length;
    const users = slim.filter((message) => message.role === 'user').map(userText);
    expect(users.some((text) => text.includes('<summary>'))).toBe(true);
    expect(users.some((text) => text.includes('wake'))).toBe(false);
    expect(users.at(-1)).toBe('what did we leave open?');
    expect(users.filter((text) => !text.includes('<summary>')).length).toBeLessThanOrEqual(
      COLD_RECENT_EXCHANGES,
    );
    expect(after * 4).toBeLessThan(before);
    expect(after).toBeLessThan(80_000);
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
