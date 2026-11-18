import type { Message, ToolResultMessage } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import {
  ANTHROPIC_SHORT_TTL_MS,
  cacheTtlMsFor,
  contextResumeOf,
  imageOmissionNote,
  isColdResume,
  resumeExpiresAtOf,
  stripConsumedImages,
  truncateOldToolResults,
} from '../../src/coordinator/runtime/cold-slim.js';

const user = (text: string, timestamp = 1): Message => ({
  role: 'user',
  content: text,
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

describe('cacheTtlMsFor', () => {
  it('uses five minutes, or one hour on the long tier, for Anthropic', () => {
    expect(cacheTtlMsFor('short', 'anthropic/claude-sonnet-5-5')).toBe(5 * 60_000);
    expect(cacheTtlMsFor('long', 'anthropic/claude-opus-5')).toBe(60 * 60_000);
  });

  it('uses thirty minutes for OpenAI models from GPT-5.6 on and nothing for older ones', () => {
    expect(cacheTtlMsFor('short', 'openai/gpt-6.1-sol')).toBe(30 * 60_000);
    expect(cacheTtlMsFor('short', 'openai/gpt-5.6-terra')).toBe(30 * 60_000);
    expect(cacheTtlMsFor('short', 'openai/gpt-5.5')).toBeNull();
    expect(cacheTtlMsFor('short', 'openai/gpt-4o')).toBeNull();
  });

  it('reports no lifetime for providers that do not guarantee one', () => {
    expect(cacheTtlMsFor('short', 'openai-codex/gpt-6.1-sol')).toBeNull();
    expect(cacheTtlMsFor('short', 'deepseek/deepseek-v4.1-flash')).toBeNull();
    expect(cacheTtlMsFor('short', 'google/gemini-4-carbon')).toBeNull();
    expect(cacheTtlMsFor('long', 'openai/gpt-6.1-sol')).toBeNull();
  });

  it('reads the Claude Code tier from its one-hour cache writes', () => {
    expect(
      cacheTtlMsFor('short', 'claude-code/claude-sonnet-5-5', { total: 900, oneHour: 400 }),
    ).toBe(60 * 60_000);
    expect(cacheTtlMsFor('long', 'claude-code/claude-sonnet-5-5', { total: 900, oneHour: 0 })).toBe(
      5 * 60_000,
    );
    expect(cacheTtlMsFor('short', 'claude-code/claude-sonnet-5-5')).toBeNull();
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

describe('contextResumeOf', () => {
  const usage = (model: string) => ({
    createdAt: 0,
    cacheRead: 0,
    input: 4_000,
    contextTokens: 20_000,
    model,
  });

  it('is idle before the first turn, warm on the same model and cold after a model switch', () => {
    expect(contextResumeOf({ lastUsage: null, activeModel: 'openai/gpt' })).toBe('idle');
    expect(contextResumeOf({ lastUsage: usage('openai/gpt'), activeModel: 'openai/gpt' })).toBe(
      'warm',
    );
    expect(
      contextResumeOf({ lastUsage: usage('anthropic/claude'), activeModel: 'openai/gpt' }),
    ).toBe('cold');
  });
});

describe('resumeExpiresAtOf', () => {
  it('schedules only a warm resume, from the last usage', () => {
    expect(
      resumeExpiresAtOf({
        resume: 'warm',
        retentionMs: ANTHROPIC_SHORT_TTL_MS,
        lastUsageCreatedAt: 1_000,
      }),
    ).toBe(1_000 + ANTHROPIC_SHORT_TTL_MS);
    expect(
      resumeExpiresAtOf({
        resume: 'cold',
        retentionMs: ANTHROPIC_SHORT_TTL_MS,
        lastUsageCreatedAt: 1_000,
      }),
    ).toBeNull();
  });
});

function toolResultChars(message: Message): string {
  if (message.role !== 'toolResult') return '';
  return message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n');
}
