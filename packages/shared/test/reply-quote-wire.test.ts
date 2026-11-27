import { expect, test } from 'vitest';
import { renderReplyText, replyQuoteText } from '../src/index.js';

const wire =
  '<!-- reply source=a1 lines=1 -->\n> First line\n\nChange this to X\n<!-- reply source=b2 lines=1 -->\n> Second line\n\nDrop this\n\nEverything else is fine';

test('the owner words of a two-quote message are each reply then the main text, with no markup', () => {
  expect(replyQuoteText(wire)).toBe('Change this to X\n\nDrop this\n\nEverything else is fine');
});

test('a task brief from a two-quote message shows each quote with its reply, then the main text', () => {
  expect(renderReplyText(wire)).toBe(
    '> First line\n\nChange this to X\n\n> Second line\n\nDrop this\n\nEverything else is fine',
  );
});

test('marker-looking lines inside replies, main text or an older message never become another quote', () => {
  const counted =
    '<!-- reply source=a1 lines=2 -->\n> q1\n\n<!-- reply source=x -->\n> pasted code\n<!-- reply source=b2 lines=1 -->\n> q2\n\n<!-- reply source=y lines=0 -->\n\n<!-- reply source=z lines=1 -->\n> typed by hand';
  expect(replyQuoteText(counted)).toBe(
    '<!-- reply source=x -->\n> pasted code\n\n<!-- reply source=y lines=0 -->\n\n<!-- reply source=z lines=1 -->\n> typed by hand',
  );
  const older = '<!-- reply source=m -->\n> q\n\nsee\n<!-- reply source=x -->\n> pasted';
  expect(replyQuoteText(older)).toBe('see\n<!-- reply source=x -->\n> pasted');
});

test('one quote with its own reply and a main text shows both, reply first', () => {
  expect(replyQuoteText('<!-- reply source=m lines=1 -->\n> q\n\nanswer\n\nmain')).toBe(
    'answer\n\nmain',
  );
});
