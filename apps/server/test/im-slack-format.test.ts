import { expect, onTestFinished, test } from 'vitest';
import { createSlackAdapter } from '../src/services/im/slack.js';
import type { ImEnv } from '../src/services/im/types.js';

interface FakePost {
  text?: string;
  parse?: string;
  mrkdwn?: boolean;
  link_names?: boolean;
  unfurl_links?: boolean;
  unfurl_media?: boolean;
  blocks?: { type: string; text?: string | { type: string; text: string } }[];
}

async function send(path: 'card' | 'reply', text: string) {
  const posts: FakePost[] = [];
  const env: ImEnv = {
    now: () => 0,
    sleep: async () => {},
    fetch: async (url, init) => {
      if (String(url).endsWith('/chat.postMessage')) posts.push(JSON.parse(String(init?.body)));
      return Response.json({ ok: true, url: 'wss://fixture.invalid' });
    },
    connectSocket: (_url, handlers) => ({
      send: () => {},
      close: () => handlers.onClose(1000, ''),
    }),
  };
  const session = await createSlackAdapter(env).connect(
    { appToken: 'app-fixture', botToken: 'bot-fixture' },
    { onStatus: () => {}, onMessage: () => {} },
    env,
  );
  onTestFinished(() => session.stop());
  await session.send({
    chatKey: 'fixture',
    text,
    ...(path === 'card' ? { buttons: [[{ label: 'Choose', value: 'fixture' }]] } : {}),
  });
  return { posts };
}

const escaped = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const markdownTexts = (post: FakePost) =>
  (post.blocks ?? []).flatMap((block) =>
    block.type === 'markdown' && typeof block.text === 'string' ? [block.text] : [],
  );

const sectionTexts = (post: FakePost) =>
  (post.blocks ?? []).flatMap((block) =>
    block.type === 'section' && typeof block.text === 'object' ? [block.text.text] : [],
  );

const isPlainSection = (block: { type: string; text?: unknown }) =>
  block.type === 'section' &&
  typeof block.text === 'object' &&
  (block.text as { type?: string }).type === 'plain_text';

const expectPlainPost = (post: FakePost, text: string, carded: boolean) => {
  const blocks = post.blocks ?? [];
  const body = carded ? blocks.slice(0, -1) : blocks;
  expect(body.length).toBeGreaterThan(0);
  expect(body.every(isPlainSection)).toBe(true);
  expect(sectionTexts(post).join('')).toBe(text);
  if (carded) expect(blocks.at(-1)?.type).toBe('actions');
};

test('a card posts its text in a plain text section', async () => {
  const text = 'ship **now**?\n\n- one\n- two';
  const { posts } = await send('card', text);
  expect(posts).toHaveLength(1);
  expect(posts[0]?.blocks).toEqual([
    { type: 'section', text: { type: 'plain_text', text } },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Choose' },
          value: 'fixture',
          action_id: 'cairn-0-0',
        },
      ],
    },
  ]);
  expect(posts[0]).toMatchObject({
    text,
    mrkdwn: false,
    parse: 'none',
    unfurl_links: false,
    unfurl_media: false,
  });
});

test('a card keeps choice numbers literal after a question that ends in a list', async () => {
  const text = 'Check first:\n1. Check the details\n\n1. Approve\n2. Reject';
  const { posts } = await send('card', text);
  expect(posts).toHaveLength(1);
  expect(posts[0]?.blocks?.[0]).toEqual({
    type: 'section',
    text: { type: 'plain_text', text },
  });
  expect(posts[0]?.blocks?.at(-1)?.type).toBe('actions');
});

test('a reply posts a markdown block with a plain text fallback', async () => {
  const text = 'reply with **bold** and _soft_';
  const { posts } = await send('reply', text);
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({
    text,
    parse: 'none',
    link_names: false,
    mrkdwn: false,
    unfurl_links: false,
    unfurl_media: false,
  });
  expect(posts[0]?.blocks).toEqual([{ type: 'markdown', text }]);
});

test.each(['card', 'reply'] as const)(
  '%s keeps mention and slack link syntax inert',
  async (path) => {
    const text = 'a <!channel> <@U42> <https://approve.example/now|ok> & < > z';
    const { posts } = await send(path, text);
    expect(posts).toHaveLength(1);
    if (path === 'card') {
      expectPlainPost(posts[0]!, text, true);
    } else {
      expect(markdownTexts(posts[0]!)).toEqual([escaped(text)]);
    }
    expect(posts[0]?.text).toBe(escaped(text));
  },
);

test('a card keeps markdown link markup literal', async () => {
  const text = 'see [doc](https://example.test/a?x=1&y=2) and [fn](javascript:alert(1)) now';
  const { posts } = await send('card', text);
  expect(posts).toHaveLength(1);
  expectPlainPost(posts[0]!, text, true);
});

test('a reply passes markdown link markup through for Slack to render', async () => {
  const text = 'see [doc](https://example.test/a?x=1&y=2) now';
  const { posts } = await send('reply', text);
  expect(posts).toHaveLength(1);
  expect(markdownTexts(posts[0]!)).toEqual([escaped(text)]);
});

test('a reply falls back to plain text when any link target is not http(s)', async () => {
  const text =
    'read [the doc](https://docs.example/p?q=1&r=2) but not [local](file:///etc/hosts) nor [fn](javascript:alert(1)) nor [oops](javascript:';
  const { posts } = await send('reply', text);
  expect(posts).toHaveLength(1);
  expectPlainPost(posts[0]!, text, false);
});

test('a reply falls back to plain text when a link destination spans lines', async () => {
  const text = 'see [doc](\njavascript:go\n) end';
  const { posts } = await send('reply', text);
  expect(posts).toHaveLength(1);
  expectPlainPost(posts[0]!, text, false);
});

test('a reply falls back to plain text for a link label with nested brackets', async () => {
  const text = 'a [[x]](javascript:go) b';
  const { posts } = await send('reply', text);
  expect(posts).toHaveLength(1);
  expectPlainPost(posts[0]!, text, false);
});

test('a reply falls back to plain text when a definition destination sits on another line', async () => {
  const text = 'see [a]\n\n[a]:\njavascript:go';
  const { posts } = await send('reply', text);
  expect(posts).toHaveLength(1);
  expectPlainPost(posts[0]!, text, false);
});

test('a reply falls back to plain text for a link that escaping reveals', async () => {
  const text = '<div>\n[go](javascript:go)';
  const { posts } = await send('reply', text);
  expect(posts).toHaveLength(1);
  expectPlainPost(posts[0]!, text, false);
});

test('a reply falls back to plain text for autolinks, references and bare schemes', async () => {
  const text =
    '<javascript:go(1)> and [a][b] then\n[b]: javascript:go\nsee file:///etc/p or mail a@b.co or [c] with\n[c]: https://c.example/x';
  const { posts } = await send('reply', text);
  expect(posts).toHaveLength(1);
  expectPlainPost(posts[0]!, text, false);
});

test.each(['card', 'reply'] as const)(
  '%s sends an email address inside code byte-for-byte',
  async (path) => {
    const text = 'ping `ops@example.com` here\n```\nmail admin@example.com\n```';
    const { posts } = await send(path, text);
    expect(posts).toHaveLength(1);
    if (path === 'card') {
      expectPlainPost(posts[0]!, text, true);
    } else {
      expect(markdownTexts(posts[0]!)).toEqual([escaped(text)]);
    }
  },
);

test('a card that fits its posted fields is accepted', async () => {
  const text = 'a@b.co '.repeat(5714);
  const { posts } = await send('card', text);
  expect(posts).toHaveLength(1);
  expect(posts[0]?.text).toBe(text);
  expectPlainPost(posts[0]!, text, true);
});

test('an over-limit reply arrives whole as plain text sections, paragraph breaks or not', async () => {
  const text = `${'a'.repeat(6000)}\n\n${'b'.repeat(7000)}\n\n${'c'.repeat(2000)}`;
  const { posts } = await send('reply', text);
  expect(posts).toHaveLength(1);
  const blocks = posts[0]?.blocks ?? [];
  expect(blocks.every(isPlainSection)).toBe(true);
  expect(sectionTexts(posts[0]!).join('')).toBe(text);
});

test('an over-limit reply segment falls back to plain text and arrives whole', async () => {
  const text = 'x'.repeat(13_000);
  const { posts } = await send('reply', text);
  expect(posts).toHaveLength(1);
  const blocks = posts[0]?.blocks ?? [];
  expect(blocks.length).toBe(5);
  expect(blocks.every(isPlainSection)).toBe(true);
  const sections = sectionTexts(posts[0]!);
  for (const section of sections) expect(section.length).toBeLessThanOrEqual(3000);
  expect(sections.join('')).toBe(text);
});

test('a reply over fifty plain sections keeps arriving across messages', async () => {
  const text = 'x'.repeat(160_000);
  const { posts } = await send('reply', text);
  expect(posts).toHaveLength(2);
  for (const post of posts) {
    expect((post.blocks ?? []).every(isPlainSection)).toBe(true);
    expect((post.blocks ?? []).length).toBeLessThanOrEqual(50);
  }
  expect(posts.flatMap(sectionTexts).join('')).toBe(text);
});

test('an over-limit fenced block arrives whole as plain text', async () => {
  const text = `\`\`\`\n${'x'.repeat(13_000)}\n\`\`\``;
  const { posts } = await send('reply', text);
  expect(posts).toHaveLength(1);
  expect((posts[0]?.blocks ?? []).every(isPlainSection)).toBe(true);
  expect(sectionTexts(posts[0]!).join('')).toBe(text);
});

test('a card posts a text heavy on escapes as plain sections', async () => {
  const text = '&'.repeat(2500);
  const { posts } = await send('card', text);
  expect(posts).toHaveLength(1);
  const blocks = posts[0]?.blocks ?? [];
  expect(blocks.slice(0, -1).every(isPlainSection)).toBe(true);
  expect(sectionTexts(posts[0]!).join('')).toBe(text);
  expect(blocks.at(-1)?.type).toBe('actions');
});

test('a reply carries CRLF and stray angle brackets verbatim', async () => {
  const { posts } = await send('reply', 'a\r\nb>');
  expect(posts).toHaveLength(1);
  expect(markdownTexts(posts[0]!)).toEqual(['a\r\nb&gt;']);
  expect(posts[0]?.text).toBe('a\r\nb&gt;');
});

test('a whitespace-only reply posts nothing', async () => {
  const { posts } = await send('reply', '   \n\n  ');
  expect(posts).toHaveLength(0);
});

test('a whitespace run between paragraphs rides inside the message', async () => {
  const text = `a\n\n${'\n'.repeat(5000)}tail`;
  const { posts } = await send('reply', text);
  expect(posts).toHaveLength(1);
  expect(markdownTexts(posts[0]!)).toEqual([text]);
});

test('a markdown reply text fallback keeps an entity ending exactly on the limit', async () => {
  const text = `${'x'.repeat(3995)}&`;
  const { posts } = await send('reply', text);
  expect(posts).toHaveLength(1);
  expect(posts[0]?.text).toBe(`${'x'.repeat(3995)}&amp;`);
});

test('a markdown reply text fallback cuts before an entity it cannot finish', async () => {
  const text = `${'x'.repeat(3996)}&&&`;
  const { posts } = await send('reply', text);
  expect(posts).toHaveLength(1);
  expect(posts[0]?.text).toBe('x'.repeat(3996));
  expect(markdownTexts(posts[0]!)).toEqual([`${'x'.repeat(3996)}${'&amp;'.repeat(3)}`]);
});

test('a plain reply text fallback escapes before the four-thousand-unit cut', async () => {
  const text = `${'y'.repeat(3999)}&${'z'.repeat(9000)}`;
  const { posts } = await send('reply', text);
  expect(posts).toHaveLength(1);
  expect(posts[0]?.text).toBe('y'.repeat(3999));
  expect((posts[0]?.blocks ?? []).every(isPlainSection)).toBe(true);
  expect(sectionTexts(posts[0]!).join('')).toBe(text);
});

test('a plain reply text fallback keeps an entity ending exactly on the limit', async () => {
  const text = `${'y'.repeat(3995)}&${'z'.repeat(9000)}`;
  const { posts } = await send('reply', text);
  expect(posts).toHaveLength(1);
  expect(posts[0]?.text).toBe(`${'y'.repeat(3995)}&amp;`);
});
