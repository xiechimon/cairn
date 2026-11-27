import { describe, expect, test } from 'vitest';
import {
  encodeReplyQuotes,
  parseReplyQuotes,
  REPLY_QUOTE_LIMIT,
  replyQuoteText,
  replySummary,
} from '../src/reply-quote.js';

const one = (sourceMessageId: string, quote: string, reply: string) =>
  encodeReplyQuotes([{ sourceMessageId, quote, reply }], '');
const first = (content: string) => {
  const parsed = parseReplyQuotes(content);
  if (parsed === null) return null;
  const [quote] = parsed.quotes;
  return { sourceMessageId: quote?.sourceMessageId, quote: quote?.quote, body: quote?.reply };
};

describe('encodeReplyQuotes', () => {
  test('writes the marker, a quoted block and the reply', () => {
    expect(one('msg_1', 'one\ntwo', ' why? ')).toBe(
      '<!-- reply source=msg_1 -->\n> one\n> two\n\nwhy?',
    );
  });

  test('normalises line endings and keeps blank quote lines inside the block', () => {
    expect(one('m', '\r\na\r\n\r\nb\r\n', 'x')).toBe('<!-- reply source=m -->\n> a\n>\n> b\n\nx');
  });

  test('cuts a long quote with an ellipsis without splitting a surrogate pair', () => {
    const quote = `${'a'.repeat(REPLY_QUOTE_LIMIT - 1)}😀tail`;
    const parsed = first(one('m', quote, 'x'));
    expect(parsed?.quote).toBe(`${'a'.repeat(REPLY_QUOTE_LIMIT - 1)}…`);
  });

  test('drops a source id that could break out of the marker', () => {
    const wire = one('x --> y', 'q', 'b');
    expect(wire).toBe('<!-- reply -->\n> q\n\nb');
    expect(first(wire)).toEqual({ sourceMessageId: null, quote: 'q', body: 'b' });
  });
});

describe('parseReplyQuotes', () => {
  test('round-trips the source, the quote and the reply', () => {
    const wire = one('msg_9', 'Line one\n\n- item', 'Reply\n> not a quote');
    expect(first(wire)).toEqual({
      sourceMessageId: 'msg_9',
      quote: 'Line one\n\n- item',
      body: 'Reply\n> not a quote',
    });
  });

  test('reads the Claude Code marker without a source', () => {
    expect(first('<!-- reply -->\n> q\n\nbody')).toEqual({
      sourceMessageId: null,
      quote: 'q',
      body: 'body',
    });
  });

  test('returns null for plain text and for a marker with no quote', () => {
    expect(first('hello')).toBeNull();
    expect(first('> just a quote\n\nbody')).toBeNull();
    expect(first('<!-- reply source=m -->\nbody')).toBeNull();
    expect(first('text\n<!-- reply source=m -->\n> q\n\nbody')).toBeNull();
  });
});

describe('replyQuoteText', () => {
  test.each(['<!-- reply -->', '<!-- reply source=m -->'])(
    'strips an orphan leading marker through the shared parser: %s',
    (marker) => {
      expect(replyQuoteText(marker)).toBe('');
      expect(replyQuoteText(`${marker}\nFinish the task`)).toBe('Finish the task');
      expect(first(`${marker}\nFinish the task`)).toBeNull();
    },
  );

  test('keeps marker-like text outside the leading wire envelope', () => {
    const text = 'Explain this literal: \n<!-- reply source=m -->';
    expect(replyQuoteText(text)).toBe(text);
  });

  test('shows the reply alone for a quoted message and the text otherwise', () => {
    expect(replyQuoteText('<!-- reply source=m -->\n> q\n\nbody')).toBe('body');
    expect(replyQuoteText('plain')).toBe('plain');
  });
});

describe('several quotes, each with its own reply', () => {
  const quotes = [
    { sourceMessageId: 'a1', quote: 'First line', reply: 'Change this to X\n\nand this' },
    { sourceMessageId: 'b2', quote: 'Second\nline', reply: '' },
  ];
  const wire =
    '<!-- reply source=a1 lines=3 -->\n> First line\n\nChange this to X\n\nand this\n<!-- reply source=b2 lines=0 -->\n> Second\n> line\n\nEverything else is fine';

  test('writes each block with its reply line count and the main text after a blank line', () => {
    expect(encodeReplyQuotes(quotes, ' Everything else is fine ')).toBe(wire);
  });

  test('the owner words of a multi-quote message are every reply then the main text, never a marker', () => {
    expect(replyQuoteText(wire)).toBe('Change this to X\n\nand this\n\nEverything else is fine');
  });

  test('round-trips every quote, its reply and the main text', () => {
    expect(parseReplyQuotes(wire)).toEqual({
      quotes: [
        { sourceMessageId: 'a1', quote: 'First line', reply: 'Change this to X\n\nand this' },
        { sourceMessageId: 'b2', quote: 'Second\nline', reply: '' },
      ],
      body: 'Everything else is fine',
    });
  });

  test('replies and main text holding marker and quote lines stay text', () => {
    const tricky = [
      { sourceMessageId: 'a1', quote: 'q1', reply: '<!-- reply source=x -->\n> pasted code' },
      { sourceMessageId: 'b2', quote: 'q2', reply: '<!-- reply source=y lines=0 -->' },
    ];
    const body = '<!-- reply source=z lines=1 -->\n> typed by hand\n\nend';
    expect(parseReplyQuotes(encodeReplyQuotes(tricky, body))).toEqual({
      quotes: [
        { sourceMessageId: 'a1', quote: 'q1', reply: tricky[0]?.reply },
        { sourceMessageId: 'b2', quote: 'q2', reply: tricky[1]?.reply },
      ],
      body,
    });
  });

  test('one quote with its own reply and a main text keeps both apart', () => {
    const one = encodeReplyQuotes([{ sourceMessageId: 'm', quote: 'q', reply: 'answer' }], 'main');
    expect(replyQuoteText(one)).toBe('answer\n\nmain');
    expect(parseReplyQuotes(one)).toEqual({
      quotes: [{ sourceMessageId: 'm', quote: 'q', reply: 'answer' }],
      body: 'main',
    });
  });

  test('a single quote with one text keeps the format older readers parse', () => {
    expect(encodeReplyQuotes([{ sourceMessageId: 'm', quote: 'q', reply: '' }], 'main')).toBe(
      '<!-- reply source=m -->\n> q\n\nmain',
    );
    expect(encodeReplyQuotes([{ sourceMessageId: 'm', quote: 'q', reply: 'main' }], '')).toBe(
      '<!-- reply source=m -->\n> q\n\nmain',
    );
    expect(encodeReplyQuotes([{ sourceMessageId: 'm', quote: 'q', reply: '' }], 'a\r\nb')).toBe(
      '<!-- reply source=m -->\n> q\n\na\r\nb',
    );
  });

  test('an older single-quote message whose text holds marker lines still reads as one quote', () => {
    const old = '<!-- reply source=m -->\n> q\n\nsee\n<!-- reply source=x -->\n> pasted';
    expect(replyQuoteText(old)).toBe('see\n<!-- reply source=x -->\n> pasted');
    expect(parseReplyQuotes(old)?.quotes).toHaveLength(1);
  });

  test('a message of quotes alone is summarised by its quoted words', () => {
    const quotesOnly = encodeReplyQuotes(
      [
        { sourceMessageId: 'a1', quote: 'First', reply: '' },
        { sourceMessageId: 'b2', quote: 'Second', reply: '' },
      ],
      '',
    );
    expect(replySummary(quotesOnly)).toBe('First\nSecond');
    expect(replySummary(wire)).toBe(replyQuoteText(wire));
  });

  test('no quotes sends the main text alone', () => {
    expect(encodeReplyQuotes([], ' hi ')).toBe('hi');
  });
});
