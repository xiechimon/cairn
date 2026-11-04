import { performance } from 'node:perf_hooks';
import { describe, expect, test } from 'vitest';
import {
  parseRawEvidenceLinks,
  qualifyingEvidenceLinks,
} from '../src/services/merge-gate/evidence-link.js';

const SHA = 'f44b920639de983be1e050899e5217509204b43f';
const raw = (path: string, sha = SHA, slug = 'xiechimon/cairn') =>
  `https://raw.githubusercontent.com/${slug}/${sha}/${path}`;
const parse = (body: string, ticketRef = '1404') =>
  parseRawEvidenceLinks(body, { owner: 'xiechimon', repo: 'cairn', ticketRef });

describe('parseRawEvidenceLinks', () => {
  test('markdown links and <img src> both count, paths are URL-decoded', () => {
    const body = [
      `[result](${raw('docs/verify/1404/result.json')})`,
      `<img src="${raw('docs/verify/1404/01%20board.png')}" width="720">`,
    ].join('\n');
    expect(parse(body).links).toEqual([
      { sha: SHA, path: 'docs/verify/1404/result.json' },
      { sha: SHA, path: 'docs/verify/1404/01 board.png' },
    ]);
  });

  test('another repo, another ticket, short SHA, uppercase SHA and branch names do not count, listed in others', () => {
    const body = [
      raw('docs/verify/1404/a.json', SHA, 'someone/cairn'),
      raw('docs/verify/1403/a.json'),
      raw('docs/verify/1404/a.json', SHA.slice(0, 7)),
      raw('docs/verify/1404/a.json', SHA.toUpperCase()),
      raw('docs/verify/1404/a.json', 'main'),
      raw('apps/server/src/a.ts'),
    ].join('\n');
    const r = parse(body);
    expect(r.links).toEqual([]);
    expect(r.others.length).toBe(6);
  });

  test('one ticket number a prefix of another: docs/verify/14040/ is not evidence for 1404', () => {
    const r = parse(raw('docs/verify/14040/a.json'));
    expect(r.links).toEqual([]);
    expect(r.others).toEqual([raw('docs/verify/14040/a.json')]);
  });

  test('repo names are case-insensitive', () => {
    expect(parse(raw('docs/verify/1404/a.json', SHA, 'XieChimon/Cairn')).links).toHaveLength(1);
  });

  test('links inside HTML comments do not count', () => {
    const body = `<!-- ${raw('docs/verify/1404/a.json')} -->\nno links`;
    expect(parse(body)).toEqual({ links: [], others: [] });
  });

  test('the same link appearing twice is recorded once', () => {
    const url = raw('docs/verify/1404/a.json');
    expect(parse(`${url}\n[a](${url})`).links).toHaveLength(1);
  });

  test('the same file is recorded once by decoded sha and path: a different owner case or a path written %61 is the same file', () => {
    const body = [
      raw('docs/verify/1404/a.txt'),
      raw('docs/verify/1404/%61.txt', SHA, 'XiechiMon/Cairn'),
    ].join('\n');
    expect(parse(body)).toEqual({
      links: [{ sha: SHA, path: 'docs/verify/1404/a.txt' }],
      others: [],
    });
  });

  test('the same path pinned at two SHAs is two entries', () => {
    const other = 'a'.repeat(40);
    const body = [raw('docs/verify/1404/a.txt'), raw('docs/verify/1404/a.txt', other)].join('\n');
    expect(parse(body).links).toEqual([
      { sha: SHA, path: 'docs/verify/1404/a.txt' },
      { sha: other, path: 'docs/verify/1404/a.txt' },
    ]);
  });

  test('a bad percent escape (%E0%A4%A) lands in others, no throw', () => {
    const url = raw('docs/verify/1404/%E0%A4%A');
    expect(() => parse(url)).not.toThrow();
    expect(parse(url)).toEqual({ links: [], others: [url] });
  });

  test('punctuation and backticks right after a link do not join the path', () => {
    const url = raw('docs/verify/1404/a.json');
    const body = [`\`${url}\``, `(see ${url}).`, `${url}, ${url};`].join('\n');
    expect(parse(body).links).toEqual([{ sha: SHA, path: 'docs/verify/1404/a.json' }]);
  });

  test('a link after a closed comment counts as usual', () => {
    const body = `<!-- template note -->\n${raw('docs/verify/1404/a.json')}`;
    expect(parse(body).links).toHaveLength(1);
  });

  test('a link between two closed comments counts as usual', () => {
    const body = `<!-- a -->\n${raw('docs/verify/1404/a.json')}\n<!-- b -->`;
    expect(parse(body)).toEqual({
      links: [{ sha: SHA, path: 'docs/verify/1404/a.json' }],
      others: [],
    });
  });

  test('a URL split by a comment is not rejoined into one link: GitHub renders only the part before the comment', () => {
    const url = raw('docs/verify/1404/a.json');
    const cut = url.indexOf(SHA) + 6;
    const body = `${url.slice(0, cut)}<!-- x -->${url.slice(cut)}`;
    expect(parse(body)).toEqual({ links: [], others: [url.slice(0, cut)] });
  });

  test('empty comments <!--> and <!---> end at their own --> (same as HTML and cmark-gfm), links after them count', () => {
    const a = raw('docs/verify/1404/a.txt');
    const b = raw('docs/verify/1404/b.txt');
    expect(parse(`<!--> see ${a}`)).toEqual({
      links: [{ sha: SHA, path: 'docs/verify/1404/a.txt' }],
      others: [],
    });
    expect(parse(`<!---> see ${b}`)).toEqual({
      links: [{ sha: SHA, path: 'docs/verify/1404/b.txt' }],
      others: [],
    });
    expect(parse(`<!-- x ${a} -->`)).toEqual({ links: [], others: [] });
  });

  test('an unclosed HTML comment swallows the rest (GitHub does not render it), links inside do not count', () => {
    const body = `ok\n<!-- draft\n${raw('docs/verify/1404/a.json')}`;
    expect(parse(body)).toEqual({ links: [], others: [] });
  });

  test('an unclosed <!-- mid-line (e.g. quoted in backticks) is literal text and swallows nothing', () => {
    const body = `The parser skips \`<!--\` comments.\n\n## Verified\n\n[a](${raw('docs/verify/1404/a.txt')})`;
    expect(parse(body)).toEqual({
      links: [{ sha: SHA, path: 'docs/verify/1404/a.txt' }],
      others: [],
    });
  });

  test('an unclosed <!-- indented by at most three spaces at line start opens an HTML block and swallows the rest; four spaces is an indented code block and swallows nothing', () => {
    const a = raw('docs/verify/1404/a.txt');
    expect(parse(`ok\n   <!-- draft\n${a}`)).toEqual({ links: [], others: [] });
    expect(parse(`ok\n\n    <!-- draft\n\n${a}`)).toEqual({
      links: [{ sha: SHA, path: 'docs/verify/1404/a.txt' }],
      others: [],
    });
  });

  test('directory traversal and out-of-repo paths do not count', () => {
    const r = parse(raw('docs/verify/1404/../1403/a.json'));
    expect(r.links).toEqual([]);
  });

  test('paths with a . segment do not count, listed in others', () => {
    const url = raw('docs/verify/1404/./a.json');
    expect(parse(url)).toEqual({ links: [], others: [url] });
  });

  test('query strings and fragments are not part of the path: ?raw=true and #L3 still count, the same file recorded once', () => {
    const body = [
      `${raw('docs/verify/1404/a.json')}?raw=true`,
      `[log](${raw('docs/verify/1404/b.txt')}#L3)`,
      `${raw('docs/verify/1404/b.txt')}?x=1#L3-L5.`,
      raw('docs/verify/1404/a.json'),
    ].join('\n');
    expect(parse(body)).toEqual({
      links: [
        { sha: SHA, path: 'docs/verify/1404/a.json' },
        { sha: SHA, path: 'docs/verify/1404/b.txt' },
      ],
      others: [],
    });
  });

  test('after stripping query and fragment what does not point at a file does not count: a directory itself is not evidence', () => {
    const body = [
      `${raw('docs/verify/1404/')}?raw=true`,
      `${raw('docs/verify/1404/sub/')}#top`,
    ].join('\n');
    const r = parse(body);
    expect(r.links).toEqual([]);
    expect(r.others).toHaveLength(2);
  });

  const BODY_LIMIT = 65_536;
  const adversarial: [string, string][] = [
    [
      '一条链接后跟一长串句点再加一个字母',
      (() => {
        const head = raw('docs/verify/1404/a.json');
        return `${head}${'.'.repeat(BODY_LIMIT - head.length - 1)}a`;
      })(),
    ],
    ['成串没闭合的 <!--', '<!--'.repeat(BODY_LIMIT / 4)],
    ['一行里成串没闭合的 <!--', `${'x<!--'.repeat((BODY_LIMIT - 1) / 5)}x`],
  ];
  for (const [label, body] of adversarial) {
    test(`adversarial body parses linearly: ${label}, 65,536 characters within 200 ms`, () => {
      expect(body.length).toBe(BODY_LIMIT);
      const t0 = performance.now();
      parse(body);
      expect(performance.now() - t0).toBeLessThan(200);
    });
  }
});

describe('parseRawEvidenceLinks: decoded path segment safety (S4b)', () => {
  test.each([
    ['%2e%2e 穿越', 'docs/verify/1404/%2e%2e/1405/x.png'],
    ['%2E%2E 大写', 'docs/verify/1404/%2E%2E/%2E%2E/README.md'],
    ['%2F 把一段拆成两段', 'docs/verify/1404/a%2F..%2F..%2Fx.png'],
    ['%2F 拼出目录', 'docs/verify/1404/sub%2Fx.png'],
    ['%5C 反斜杠', 'docs/verify/1404/a%5Cb.png'],
    ['%3F 问号', 'docs/verify/1404/a%3Fb.png'],
    ['%23 井号', 'docs/verify/1404/a%23b.png'],
    ['%0A 换行', 'docs/verify/1404/a%0Ab.png'],
    ['%00 NUL', 'docs/verify/1404/a%00b.png'],
    ['%7F 控制字符', 'docs/verify/1404/a%7Fb.png'],
  ])('%s：不算', (_label, path) => {
    const r = parse(raw(path));
    expect(r.links).toEqual([]);
    expect(r.others).toEqual([raw(path)]);
  });

  test('false leg: ordinary characters like spaces, CJK and plus signs count as usual', () => {
    expect(parse(raw('docs/verify/1404/01%20%E6%88%AA%E5%9B%BE+a.png')).links).toEqual([
      { sha: SHA, path: 'docs/verify/1404/01 截图+a.png' },
    ]);
  });
});

describe('qualifyingEvidenceLinks', () => {
  const OTHER = 'a'.repeat(40);
  const compare = {
    commits: [{ sha: SHA }],
    files: [
      { status: 'added', filename: 'docs/verify/1404/a.png' },
      { status: 'modified', filename: 'docs/verify/1404/b.json' },
      { status: 'removed', filename: 'docs/verify/1404/gone.png' },
      { status: 'renamed', filename: 'docs/verify/1404/new.txt' },
    ],
  };
  const q = (body: string) =>
    qualifyingEvidenceLinks(
      body,
      { owner: 'xiechimon', repo: 'cairn', ticketRef: '1404' },
      compare,
    );

  test('the commit is in this PR and the file was added or changed by this PR: qualified, in body order', () => {
    const body = [
      raw('docs/verify/1404/b.json'),
      raw('docs/verify/1404/a.png'),
      raw('docs/verify/1404/new.txt'),
    ].join(' ');
    expect(q(body)).toEqual([
      { sha: SHA, path: 'docs/verify/1404/b.json' },
      { sha: SHA, path: 'docs/verify/1404/a.png' },
      { sha: SHA, path: 'docs/verify/1404/new.txt' },
    ]);
  });

  test('commit outside this PR, file deleted by this PR, file not in the patch, another ticket: all unqualified', () => {
    const body = [
      raw('docs/verify/1404/a.png', OTHER),
      raw('docs/verify/1404/gone.png'),
      raw('docs/verify/1404/untouched.png'),
      raw('docs/verify/1405/a.png'),
    ].join(' ');
    expect(q(body)).toEqual([]);
  });
});
