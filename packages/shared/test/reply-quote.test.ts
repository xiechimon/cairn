import { describe, expect, test } from 'vitest';
import {
  encodeReplyQuote,
  parseReplyQuote,
  REPLY_QUOTE_LIMIT,
  replyQuoteText,
} from '../src/reply-quote.js';

describe('encodeReplyQuote', () => {
  test('writes the marker, a quoted block and the reply', () => {
    expect(encodeReplyQuote({ sourceMessageId: 'msg_1', quote: 'one\ntwo' }, ' why? ')).toBe(
      '<!-- reply source=msg_1 -->\n> one\n> two\n\nwhy?',
    );
  });

  test('normalises line endings and keeps blank quote lines inside the block', () => {
    expect(encodeReplyQuote({ sourceMessageId: 'm', quote: '\r\na\r\n\r\nb\r\n' }, 'x')).toBe(
      '<!-- reply source=m -->\n> a\n>\n> b\n\nx',
    );
  });

  test('cuts a long quote with an ellipsis without splitting a surrogate pair', () => {
    const quote = `${'a'.repeat(REPLY_QUOTE_LIMIT - 1)}😀tail`;
    const parsed = parseReplyQuote(encodeReplyQuote({ sourceMessageId: 'm', quote }, 'x'));
    expect(parsed?.quote).toBe(`${'a'.repeat(REPLY_QUOTE_LIMIT - 1)}…`);
  });

  test('drops a source id that could break out of the marker', () => {
    const wire = encodeReplyQuote({ sourceMessageId: 'x --> y', quote: 'q' }, 'b');
    expect(wire).toBe('<!-- reply -->\n> q\n\nb');
    expect(parseReplyQuote(wire)).toEqual({ sourceMessageId: null, quote: 'q', body: 'b' });
  });
});

describe('parseReplyQuote', () => {
  test('round-trips the source, the quote and the reply', () => {
    const wire = encodeReplyQuote(
      { sourceMessageId: 'msg_9', quote: 'Line one\n\n- item' },
      'Reply\n> not a quote',
    );
    expect(parseReplyQuote(wire)).toEqual({
      sourceMessageId: 'msg_9',
      quote: 'Line one\n\n- item',
      body: 'Reply\n> not a quote',
    });
  });

  test('reads the Claude Code marker without a source', () => {
    expect(parseReplyQuote('<!-- reply -->\n> q\n\nbody')).toEqual({
      sourceMessageId: null,
      quote: 'q',
      body: 'body',
    });
  });

  test('returns null for plain text and for a marker with no quote', () => {
    expect(parseReplyQuote('hello')).toBeNull();
    expect(parseReplyQuote('> just a quote\n\nbody')).toBeNull();
    expect(parseReplyQuote('<!-- reply source=m -->\nbody')).toBeNull();
    expect(parseReplyQuote('text\n<!-- reply source=m -->\n> q\n\nbody')).toBeNull();
  });
});

describe('replyQuoteText', () => {
  test('shows the reply alone for a quoted message and the text otherwise', () => {
    expect(replyQuoteText('<!-- reply source=m -->\n> q\n\nbody')).toBe('body');
    expect(replyQuoteText('plain')).toBe('plain');
  });
});
