import type { Message, ToolResultMessage } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import {
  COLD_RECENT_EXCHANGES,
  coldWindowStartFromRows,
  contextResumeOf,
  imageOmissionNote,
  isColdResume,
  isPureToolCallAssistant,
  projectColdMessages,
  resumeExpiresAtOf,
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

const pureToolCall = (
  id: string,
  name: string,
  args: { [key: string]: string | number | boolean | null },
  timestamp = 1,
): Message => ({
  role: 'assistant',
  content: [{ type: 'toolCall', id, name, arguments: args }],
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
  timestamp,
});

describe('isColdResume', () => {
  const lastUsage = {
    createdAt: 0,
    cacheRead: 0,
    input: 20_000,
    contextTokens: 20_100,
    model: 'openai/gpt',
  };

  it('stays warm after the cache retention window so idle time never drops the conversation', () => {
    expect(isColdResume({ lastUsage, activeModel: 'openai/gpt' })).toBe(false);
  });

  it('ignores empty first turns', () => {
    expect(isColdResume({ lastUsage: null, activeModel: 'anthropic/claude' })).toBe(false);
  });

  it('is cold only when the active router model differs from the last usage model', () => {
    expect(isColdResume({ lastUsage, activeModel: 'anthropic/claude' })).toBe(true);
    expect(isColdResume({ lastUsage, activeModel: 'openai/gpt' })).toBe(false);
    expect(isColdResume({ lastUsage, activeModel: '' })).toBe(false);
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

  it('keeps a real id from the image block when no companion token exists', () => {
    const imageBlock = {
      type: 'image' as const,
      data: 'aaa',
      mimeType: 'image/png',
      attachmentId: 'att-from-block',
    };
    const messages: Message[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'see' }, imageBlock as never],
        timestamp: 1,
      },
      user('latest'),
    ];
    const out = stripConsumedImages(messages, { keepRecentMessages: 1 });
    if (out[0]?.role !== 'user' || typeof out[0].content === 'string') throw new Error('shape');
    const note = out[0].content.find(
      (block) => block.type === 'text' && block.text.includes('omitted'),
    );
    expect(note?.type === 'text' ? note.text : '').toBe(imageOmissionNote('att-from-block'));
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

  it('drops pure tool-call assistants and their tool results from completed historical exchanges', () => {
    const pureTool = pureToolCall('c-hist', 'bash', { command: 'ls' }, 2);
    expect(isPureToolCallAssistant(pureTool)).toBe(true);
    const messages: Message[] = [
      user('u0', 1),
      pureTool,
      tool('bash', 'noise', 3),
      assistant('done after tools', 4),
      user('current', 5),
    ];
    const out = selectColdMessageWindow(messages, 8);
    expect(out.some((message) => isPureToolCallAssistant(message))).toBe(false);
    expect(out.some((message) => message.role === 'toolResult')).toBe(false);
    expect(out.filter((message) => message.role === 'user').map(userText)).toEqual([
      'u0',
      'current',
    ]);
    expect(
      out.some(
        (message) => message.role === 'assistant' && JSON.stringify(message).includes('done'),
      ),
    ).toBe(true);
  });

  it('keeps pure tool-call assistants and results that belong to the active cold turn', () => {
    const historical = pureToolCall('c-hist', 'bash', { command: 'ls' }, 2);
    const active = pureToolCall('c-active', 'bash', { command: 'pwd' }, 6);
    const messages: Message[] = [
      user('u0', 1),
      historical,
      tool('bash', 'hist-noise', 3),
      assistant('closed hist', 4),
      user('current', 5),
      active,
      tool('bash', 'active-result', 7),
    ];
    const out = selectColdMessageWindow(messages, 8);
    expect(out.filter((message) => message.role === 'user').map(userText)).toEqual([
      'u0',
      'current',
    ]);
    const pure = out.filter((message) => isPureToolCallAssistant(message));
    expect(pure).toHaveLength(1);
    expect(JSON.stringify(pure[0])).toContain('c-active');
    const results = out.filter((message) => message.role === 'toolResult');
    expect(results).toHaveLength(1);
    expect(toolResultChars(results[0]!)).toBe('active-result');
  });

  it('projectColdMessages preserves active-turn tool call and result on the next generation', () => {
    const active = pureToolCall('c-active', 'todos', { projectId: 'p1' }, 3);
    const messages: Message[] = [
      user('old', 1),
      assistant('done', 2),
      user('resume billing', 3),
      active,
      tool('todos', '[{"id":"t1","title":"ship"}]', 4),
    ];
    const out = projectColdMessages(messages, { summaryHint: 'billing pause' });
    expect(out.some((message) => userText(message).includes('<summary>'))).toBe(true);
    expect(
      out.some((message) => message.role === 'assistant' && isPureToolCallAssistant(message)),
    ).toBe(true);
    expect(
      out.some(
        (message) => message.role === 'toolResult' && toolResultChars(message).includes('ship'),
      ),
    ).toBe(true);
    expect(out.some((message) => userText(message) === 'resume billing')).toBe(true);
  });

  it('keeps pre-steer tool trails with the original user when a mid-turn steer appends', () => {
    const preSteer = pureToolCall('c-pre', 'bash', { command: 'ls' }, 2);
    const messages: Message[] = [
      user('hist', 0),
      assistant('done', 1),
      user('original', 2),
      preSteer,
      tool('bash', 'pre-steer-result', 3),
      user('steer note', 4),
    ];
    const out = selectColdMessageWindow(messages, 8);
    expect(out.filter((message) => message.role === 'user').map(userText)).toEqual([
      'hist',
      'original',
      'steer note',
    ]);
    expect(
      out.some((message) => message.role === 'assistant' && isPureToolCallAssistant(message)),
    ).toBe(true);
    expect(
      out.some(
        (message) =>
          message.role === 'toolResult' && toolResultChars(message).includes('pre-steer-result'),
      ),
    ).toBe(true);
  });
});

describe('contextResumeOf', () => {
  it('maps idle / warm / cold / compacted for the meter short states', () => {
    expect(
      contextResumeOf({
        now: 10_000,
        retentionMs: SHORT_RETENTION_MS,
        lastUsage: null,
        lastColdSlimAt: null,
      }),
    ).toBe('idle');
    expect(
      contextResumeOf({
        now: 10_000,
        retentionMs: SHORT_RETENTION_MS,
        lastUsage: {
          createdAt: 9_000,
          cacheRead: 12_000,
          input: 100,
          contextTokens: 12_100,
          model: 'openai/gpt',
        },
        lastColdSlimAt: null,
      }),
    ).toBe('warm');
    expect(
      contextResumeOf({
        now: SHORT_RETENTION_MS + 5_000,
        retentionMs: SHORT_RETENTION_MS,
        lastUsage: {
          createdAt: 0,
          cacheRead: 0,
          input: 4_000,
          contextTokens: 20_000,
          model: 'anthropic/claude',
        },
        lastColdSlimAt: null,
      }),
    ).toBe('warm');
    expect(
      contextResumeOf({
        now: 1_000,
        retentionMs: SHORT_RETENTION_MS,
        activeModel: 'openai/gpt',
        lastUsage: {
          createdAt: 0,
          cacheRead: 0,
          input: 4_000,
          contextTokens: 20_000,
          model: 'anthropic/claude',
        },
        lastColdSlimAt: null,
      }),
    ).toBe('cold');
    expect(
      contextResumeOf({
        now: SHORT_RETENTION_MS + 5_000,
        retentionMs: SHORT_RETENTION_MS,
        lastUsage: {
          createdAt: 0,
          cacheRead: 0,
          input: 4_000,
          contextTokens: 20_000,
          model: 'anthropic/claude',
        },
        lastColdSlimAt: SHORT_RETENTION_MS + 4_000,
      }),
    ).toBe('compacted');
  });

  it('prefers a newer warm turn over a recent cold-slim marker', () => {
    const slimAt = 10_000;
    expect(
      contextResumeOf({
        now: slimAt + 30_000,
        retentionMs: SHORT_RETENTION_MS,
        lastUsage: {
          createdAt: slimAt + 20_000,
          cacheRead: 12_000,
          input: 100,
          contextTokens: 12_100,
          model: 'openai/gpt',
        },
        lastColdSlimAt: slimAt,
        lastColdSlimStepId: 'cold-step',
        lastUsageStepId: 'warm-step',
      }),
    ).toBe('warm');
    expect(
      contextResumeOf({
        now: slimAt + 30_000,
        retentionMs: SHORT_RETENTION_MS,
        lastUsage: {
          createdAt: slimAt + 20_000,
          cacheRead: 12_000,
          input: 100,
          contextTokens: 12_100,
          model: 'openai/gpt',
        },
        lastColdSlimAt: slimAt,
      }),
    ).toBe('warm');
  });

  it('keeps compacted when the slim marker still owns the latest usage step', () => {
    const slimAt = 10_000;
    expect(
      contextResumeOf({
        now: slimAt + 30_000,
        retentionMs: SHORT_RETENTION_MS,
        lastUsage: {
          createdAt: slimAt - 1,
          cacheRead: 0,
          input: 4_000,
          contextTokens: 20_000,
          model: 'anthropic/claude',
        },
        lastColdSlimAt: slimAt,
        lastColdSlimStepId: 'cold-step',
        lastUsageStepId: 'cold-step',
      }),
    ).toBe('compacted');
  });

  it('is cold when the active router model differs from the last usage model', () => {
    expect(
      contextResumeOf({
        now: 10_000,
        retentionMs: SHORT_RETENTION_MS,
        activeModel: 'anthropic/claude',
        lastUsage: {
          createdAt: 9_000,
          cacheRead: 12_000,
          input: 100,
          contextTokens: 12_100,
          model: 'openai/gpt',
        },
        lastColdSlimAt: null,
      }),
    ).toBe('cold');
  });

  it('is cold when a compacted slim still owns the latest step but the route model changed', () => {
    const slimAt = 10_000;
    expect(
      contextResumeOf({
        now: slimAt + 30_000,
        retentionMs: SHORT_RETENTION_MS,
        activeModel: 'stub-gw/model-c',
        lastUsage: {
          createdAt: slimAt - 1,
          cacheRead: 0,
          input: 4_000,
          contextTokens: 20_000,
          model: 'stub-gw/model-b',
        },
        lastColdSlimAt: slimAt,
        lastColdSlimStepId: 'cold-step-b',
        lastUsageStepId: 'cold-step-b',
      }),
    ).toBe('cold');
  });
});

describe('resumeExpiresAtOf', () => {
  it('schedules warm expiry from last usage and compacted from last cold slim', () => {
    expect(
      resumeExpiresAtOf({
        resume: 'warm',
        retentionMs: SHORT_RETENTION_MS,
        lastUsageCreatedAt: 1_000,
        lastColdSlimAt: null,
      }),
    ).toBe(1_000 + SHORT_RETENTION_MS);
    expect(
      resumeExpiresAtOf({
        resume: 'compacted',
        retentionMs: SHORT_RETENTION_MS,
        lastUsageCreatedAt: 1_000,
        lastColdSlimAt: 2_000,
      }),
    ).toBe(2_000 + SHORT_RETENTION_MS);
    expect(
      resumeExpiresAtOf({
        resume: 'cold',
        retentionMs: SHORT_RETENTION_MS,
        lastUsageCreatedAt: 1_000,
        lastColdSlimAt: null,
      }),
    ).toBeNull();
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

const COLD_FIRST_SHOT_MAX_ESTIMATED_TOKENS = 22_500;

function estimatedTokens(messages: readonly Message[]): number {
  return Math.ceil(JSON.stringify(messages).length / 4);
}

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

  it('keeps cold first-shot estimated tokens well under the 22.5k miss cliff', () => {
    const fat: Message[] = [];
    for (let i = 0; i < 60; i++) {
      fat.push(user(`turn-${i} ${'body '.repeat(400)}`));
      fat.push(assistant(`reply-${i} ${'ok '.repeat(100)}`));
      fat.push(tool('tour', 'LOG '.repeat(2_000), i + 1));
      fat.push({
        role: 'user',
        content: [
          { type: 'text', text: `shot-${i}` },
          { type: 'image', data: 'x'.repeat(12_000), mimeType: 'image/png' },
        ],
        timestamp: i + 1,
      });
    }
    fat.push(user('resume the queued billing fix'));
    const beforeTokens = estimatedTokens(fat);
    expect(beforeTokens).toBeGreaterThan(COLD_FIRST_SHOT_MAX_ESTIMATED_TOKENS);
    const slim = projectColdMessages(fat, {
      summaryHint: 'queued billing fix; tour done; waiting on review',
    });
    const afterTokens = estimatedTokens(slim);
    expect(afterTokens).toBeLessThan(COLD_FIRST_SHOT_MAX_ESTIMATED_TOKENS);
    expect(slim.some((message) => JSON.stringify(message).includes('"type":"image"'))).toBe(false);
    const toolBodies = slim.filter((message) => message.role === 'toolResult').map(toolResultChars);
    expect(toolBodies.filter((text) => text.length > 1_200).length).toBeLessThanOrEqual(3);
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
