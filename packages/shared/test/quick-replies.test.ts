import { describe, expect, it } from 'vitest';
import {
  ASK_USER_QUESTION_KIND,
  CHIEF_NOTICE_KIND,
  CHIEF_REPLY_TOOLS,
  CHIEF_TOOL_NAMES,
  liveQuickReplies,
  QUICK_REPLIES_KIND,
  type QuickRepliesRow,
  quickRepliesContentSchema,
  quickRepliesRowId,
  remoteToolDefSchema,
  SUGGEST_REPLIES_TOOL_NAME,
  sanitizeQuickReplies,
} from '../src/index.js';

const owner = (id: string, text: string): QuickRepliesRow => ({ id, role: 'user', content: text });
const reply = (id: string, text: string): QuickRepliesRow => ({
  id,
  role: 'assistant',
  content: [{ type: 'text', text }],
});
const toolCall = (id: string): QuickRepliesRow => ({
  id,
  role: 'assistant',
  content: { kind: 'toolcall', call: { id, name: SUGGEST_REPLIES_TOOL_NAME, arguments: {} } },
});
const quick = (stepId: string, replies: string[]): QuickRepliesRow => ({
  id: quickRepliesRowId(stepId),
  role: 'system',
  content: JSON.stringify({ kind: QUICK_REPLIES_KIND, stepId, replies }),
});
const question = (status: 'pending' | 'answered'): QuickRepliesRow => ({
  id: 'q1',
  role: 'assistant',
  content: JSON.stringify({
    kind: ASK_USER_QUESTION_KIND,
    requestId: 'ask-1',
    status,
    questions: [{ header: '下一步', question: '先做哪个？', options: [] }],
    answers: null,
  }),
});

const TURN: QuickRepliesRow[] = [
  owner('u1', '帮我看一遍这个仓库'),
  toolCall('c1'),
  quick('s1', ['好，等你汇报', '先只看 README']),
  reply('a1', '读完后我会汇报，要先只看 README 吗？'),
];
const idle = { running: false };

describe('sanitizeQuickReplies', () => {
  it('collapses whitespace and newlines, strips markup and list markers', () => {
    expect(
      sanitizeQuickReplies(['  好，\n等你  汇报 ', '- **先只看** `README`', '1. [继续](x)']),
    ).toEqual({
      ok: true,
      replies: ['好， 等你 汇报', '先只看 README', '继续(x)'],
    });
  });

  it('drops empties and case-insensitive duplicates', () => {
    expect(sanitizeQuickReplies(['Yes', 'yes', 'No'])).toEqual({
      ok: true,
      replies: ['Yes', 'No'],
    });
    expect(sanitizeQuickReplies(['  ', 'Yes', '**'])).toEqual({ ok: true, replies: ['Yes'] });
  });

  it('rejects more than three replies', () => {
    const result = sanitizeQuickReplies(['a', 'b', 'c', 'd']);
    expect(result.ok).toBe(false);
  });

  it('rejects a reply longer than 40 characters after cleaning and accepts exactly 40', () => {
    expect(sanitizeQuickReplies(['字'.repeat(41)]).ok).toBe(false);
    expect(sanitizeQuickReplies(['字'.repeat(40)])).toEqual({
      ok: true,
      replies: ['字'.repeat(40)],
    });
    expect(sanitizeQuickReplies([`**${'a'.repeat(40)}**`]).ok).toBe(true);
  });

  it('rejects non-arrays, non-strings and an all-empty set', () => {
    expect(sanitizeQuickReplies('yes').ok).toBe(false);
    expect(sanitizeQuickReplies(['ok', 3]).ok).toBe(false);
    expect(sanitizeQuickReplies(['', ' \n ']).ok).toBe(false);
    expect(sanitizeQuickReplies([]).ok).toBe(false);
  });
});

describe('quickRepliesContentSchema', () => {
  it('enforces the caps on a stored row', () => {
    const base = { kind: QUICK_REPLIES_KIND, stepId: 's1' };
    expect(quickRepliesContentSchema.safeParse({ ...base, replies: ['ok'] }).success).toBe(true);
    expect(quickRepliesContentSchema.safeParse({ ...base, replies: [] }).success).toBe(false);
    expect(
      quickRepliesContentSchema.safeParse({ ...base, replies: ['a', 'b', 'c', 'd'] }).success,
    ).toBe(false);
    expect(
      quickRepliesContentSchema.safeParse({ ...base, replies: ['x'.repeat(41)] }).success,
    ).toBe(false);
    expect(quickRepliesContentSchema.safeParse({ ...base, replies: ['a\nb'] }).success).toBe(false);
  });
});

describe('suggest_replies tool definition', () => {
  it('stays outside the pinned 47-tool vocabulary and passes the tool shape', () => {
    expect(CHIEF_REPLY_TOOLS.map((t) => t.name)).toEqual([SUGGEST_REPLIES_TOOL_NAME]);
    expect(CHIEF_TOOL_NAMES).not.toContain(SUGGEST_REPLIES_TOOL_NAME);
    for (const def of CHIEF_REPLY_TOOLS)
      expect(remoteToolDefSchema.safeParse(def).success).toBe(true);
  });
});

describe('liveQuickReplies lifecycle', () => {
  it('row 1: shows the replies when the turn reply is the latest message and the turn is idle', () => {
    expect(liveQuickReplies(TURN, idle)).toEqual(['好，等你汇报', '先只看 README']);
  });

  it('row 1: also shows when the reply text came before the suggestions in the same turn', () => {
    const rows = [
      owner('u1', '看一下'),
      reply('a1', '要继续吗？'),
      toolCall('c1'),
      quick('s1', ['继续']),
    ];
    expect(liveQuickReplies(rows, idle)).toEqual(['继续']);
  });

  it('row 1: the newest set wins', () => {
    const rows = [...TURN.slice(0, 3), quick('s1b', ['只要这个']), TURN[3] as QuickRepliesRow];
    expect(liveQuickReplies(rows, idle)).toEqual(['只要这个']);
  });

  it('row 2: hidden once the owner sends anything after it', () => {
    expect(liveQuickReplies([...TURN, owner('u2', '好，等你汇报')], idle)).toEqual([]);
    expect(liveQuickReplies([...TURN, owner('u3', '别的事')], idle)).toEqual([]);
  });

  it('row 3: stays while the same turn is still running', () => {
    expect(liveQuickReplies(TURN, { running: true, runningStepId: 's1' })).toEqual([
      '好，等你汇报',
      '先只看 README',
    ]);
  });

  it('row 3: hidden once a newer turn runs, or the running turn is unknown, or its prompt row follows', () => {
    expect(liveQuickReplies(TURN, { running: true })).toEqual([]);
    expect(liveQuickReplies(TURN, { running: true, runningStepId: null })).toEqual([]);
    expect(liveQuickReplies(TURN, { running: true, runningStepId: 's2' })).toEqual([]);
    expect(
      liveQuickReplies([...TURN, owner('u2', '再看看')], { running: true, runningStepId: 's1' }),
    ).toEqual([]);
    expect(
      liveQuickReplies([...TURN, owner('user-s2', '[wake:failed] provenance=watch:t\n…')], idle),
    ).toEqual([]);
  });

  it('row 4: hidden while a question is pending, shown again once it is answered', () => {
    expect(liveQuickReplies([...TURN, question('pending')], idle)).toEqual([]);
    expect(
      liveQuickReplies([...TURN, question('pending')], { running: true, runningStepId: 's1' }),
    ).toEqual([]);
    expect(liveQuickReplies([question('pending'), ...TURN], idle)).toEqual([]);
    expect(liveQuickReplies([question('answered'), ...TURN], idle)).toEqual([
      '好，等你汇报',
      '先只看 README',
    ]);
  });

  it('row 5: hidden when a non-assistant row follows (notice, turn error, stop marker)', () => {
    const notice: QuickRepliesRow = {
      id: 'n1',
      role: 'system',
      content: JSON.stringify({ kind: CHIEF_NOTICE_KIND, message: 'x', provenance: 'user' }),
    };
    expect(liveQuickReplies([...TURN, notice], idle)).toEqual([]);
  });

  it('row 6: hidden when the turn wrote no reply text', () => {
    expect(
      liveQuickReplies([owner('u1', '在吗'), toolCall('c1'), quick('s1', ['在'])], idle),
    ).toEqual([]);
    expect(
      liveQuickReplies([reply('a0', '上一轮'), owner('u1', '在吗'), quick('s1', ['在'])], idle),
    ).toEqual([]);
  });

  it('row 7: absent or malformed rows give no chips', () => {
    expect(liveQuickReplies([owner('u1', 'hi'), reply('a1', 'hello')], idle)).toEqual([]);
    const bad: QuickRepliesRow = {
      id: 'quick-replies-s1',
      role: 'system',
      content: JSON.stringify({
        kind: QUICK_REPLIES_KIND,
        stepId: 's1',
        replies: ['a', 'b', 'c', 'd'],
      }),
    };
    expect(liveQuickReplies([owner('u1', 'hi'), bad, reply('a1', 'hello')], idle)).toEqual([]);
    expect(liveQuickReplies([], idle)).toEqual([]);
  });
});
