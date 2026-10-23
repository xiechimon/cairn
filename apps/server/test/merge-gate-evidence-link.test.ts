// 合并就绪闸 S1（#1404）：PR body 里的 raw 证据链（AGENTS.md「验收必核 PR body
// 的证据 raw 永久链」）。只认钉 40 位小写 SHA、指向本仓 docs/verify/<票号>/ 的
// 链接；HTML 注释里的不算（与 scripts/pr-evidence-gate.py 同一约定）。
// 失败方式先行：
// - 查询串与片段（?raw=true、#L3）被当成路径的一部分；票号是另一票号的前缀时（14040
//   与 1404）被当成本票证据；路径里有 `.` 段的被当成链接（应列进 others）。
// - body 由作者控制，最长 65,536 个字符：「一条链接后跟一长串句点再加一个字母」、成串
//   没闭合的 `<!--` 让解析回溯成平方；解析要线性。
// - 注释删掉而不是换成一个空格：被注释切开的 URL 拼成一条 GitHub 不渲染的链接
//   （scripts/pr-evidence-gate.py 同样把注释换成空白）；贪婪匹配注释把两段闭合注释之间
//   的链接吞掉。
// - `<!-->` 与 `<!--->` 被当成没闭合：它们是空注释，HTML 与 cmark-gfm 都在这个 `-->`
//   处结束。没闭合的 `<!--` 只有开 HTML 块时（行首，至多三个空格缩进；cmark-gfm 第 2
//   类 HTML 块）才吞后文，行中的（比如反引号里引用它）只是字面文字。
// - 同一文件记成两份：按解码后的 sha/路径只记一次（仓主大小写、`%61` 不同的写法是同
//   一份）；坏的百分号转义抛错，而不是列进 others。

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
  test('markdown 链接与 <img src> 都认，路径按 URL 解码', () => {
    const body = [
      `[result](${raw('docs/verify/1404/result.json')})`,
      `<img src="${raw('docs/verify/1404/01%20board.png')}" width="720">`,
    ].join('\n');
    expect(parse(body).links).toEqual([
      { sha: SHA, path: 'docs/verify/1404/result.json' },
      { sha: SHA, path: 'docs/verify/1404/01 board.png' },
    ]);
  });

  test('别的仓、别的票、短 SHA、大写 SHA、分支名都不算，列进 others', () => {
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

  test('票号是另一票号的前缀：docs/verify/14040/ 不是 1404 的证据', () => {
    const r = parse(raw('docs/verify/14040/a.json'));
    expect(r.links).toEqual([]);
    expect(r.others).toEqual([raw('docs/verify/14040/a.json')]);
  });

  test('仓名不分大小写', () => {
    expect(parse(raw('docs/verify/1404/a.json', SHA, 'XieChimon/Cairn')).links).toHaveLength(1);
  });

  test('HTML 注释里的链接不算', () => {
    const body = `<!-- ${raw('docs/verify/1404/a.json')} -->\nno links`;
    expect(parse(body)).toEqual({ links: [], others: [] });
  });

  test('同一链接出现两次只记一次', () => {
    const url = raw('docs/verify/1404/a.json');
    expect(parse(`${url}\n[a](${url})`).links).toHaveLength(1);
  });

  test('同一文件按解码后的 sha 与路径只记一次：仓主大小写不同、路径写成 %61 也是同一份', () => {
    const body = [
      raw('docs/verify/1404/a.txt'),
      raw('docs/verify/1404/%61.txt', SHA, 'XiechiMon/Cairn'),
    ].join('\n');
    expect(parse(body)).toEqual({
      links: [{ sha: SHA, path: 'docs/verify/1404/a.txt' }],
      others: [],
    });
  });

  test('同一路径钉在两个 SHA 上是两条', () => {
    const other = 'a'.repeat(40);
    const body = [raw('docs/verify/1404/a.txt'), raw('docs/verify/1404/a.txt', other)].join('\n');
    expect(parse(body).links).toEqual([
      { sha: SHA, path: 'docs/verify/1404/a.txt' },
      { sha: other, path: 'docs/verify/1404/a.txt' },
    ]);
  });

  test('坏的百分号转义（%E0%A4%A）列进 others，不抛', () => {
    const url = raw('docs/verify/1404/%E0%A4%A');
    expect(() => parse(url)).not.toThrow();
    expect(parse(url)).toEqual({ links: [], others: [url] });
  });

  test('链接后面紧跟的标点与反引号不算进路径', () => {
    const url = raw('docs/verify/1404/a.json');
    const body = [`\`${url}\``, `(see ${url}).`, `${url}, ${url};`].join('\n');
    expect(parse(body).links).toEqual([{ sha: SHA, path: 'docs/verify/1404/a.json' }]);
  });

  test('闭合的注释之后的链接照常算', () => {
    const body = `<!-- template note -->\n${raw('docs/verify/1404/a.json')}`;
    expect(parse(body).links).toHaveLength(1);
  });

  test('两段闭合注释之间的链接照常算', () => {
    const body = `<!-- a -->\n${raw('docs/verify/1404/a.json')}\n<!-- b -->`;
    expect(parse(body)).toEqual({
      links: [{ sha: SHA, path: 'docs/verify/1404/a.json' }],
      others: [],
    });
  });

  test('被注释切开的 URL 不拼回一条链接：GitHub 渲染的是注释前那一截', () => {
    const url = raw('docs/verify/1404/a.json');
    const cut = url.indexOf(SHA) + 6;
    const body = `${url.slice(0, cut)}<!-- x -->${url.slice(cut)}`;
    expect(parse(body)).toEqual({ links: [], others: [url.slice(0, cut)] });
  });

  test('空注释 <!--> 与 <!---> 在自身的 --> 处结束（HTML 与 cmark-gfm 同样），其后的链接照常算', () => {
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

  test('没闭合的 HTML 注释吞掉后文（GitHub 不渲染），其中的链接不算', () => {
    const body = `ok\n<!-- draft\n${raw('docs/verify/1404/a.json')}`;
    expect(parse(body)).toEqual({ links: [], others: [] });
  });

  test('行中没闭合的 <!--（比如反引号里引用它）只是字面文字，不吞后文', () => {
    const body = `The parser skips \`<!--\` comments.\n\n## Verified\n\n[a](${raw('docs/verify/1404/a.txt')})`;
    expect(parse(body)).toEqual({
      links: [{ sha: SHA, path: 'docs/verify/1404/a.txt' }],
      others: [],
    });
  });

  test('行首至多三个空格缩进的没闭合 <!-- 开 HTML 块，吞后文；四个空格是缩进代码块，不吞', () => {
    const a = raw('docs/verify/1404/a.txt');
    expect(parse(`ok\n   <!-- draft\n${a}`)).toEqual({ links: [], others: [] });
    expect(parse(`ok\n\n    <!-- draft\n\n${a}`)).toEqual({
      links: [{ sha: SHA, path: 'docs/verify/1404/a.txt' }],
      others: [],
    });
  });

  test('目录穿越与仓外路径不算', () => {
    const r = parse(raw('docs/verify/1404/../1403/a.json'));
    expect(r.links).toEqual([]);
  });

  test('路径里有 . 段的不算，列进 others', () => {
    const url = raw('docs/verify/1404/./a.json');
    expect(parse(url)).toEqual({ links: [], others: [url] });
  });

  test('查询串与片段不算进路径：?raw=true、#L3 照样认，同一文件只记一次', () => {
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

  test('去掉查询串与片段后不指向文件的不算：目录本身不是证据', () => {
    const body = [
      `${raw('docs/verify/1404/')}?raw=true`,
      `${raw('docs/verify/1404/sub/')}#top`,
    ].join('\n');
    const r = parse(body);
    expect(r.links).toEqual([]);
    expect(r.others).toHaveLength(2);
  });

  // GitHub 的 PR body 上限 65,536 个字符。每份构造都按这个长度；200 ms 是宽松的上界
  // （线性解析是个位数毫秒，回溯成平方的要几百毫秒到几秒）。
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
    // 行中没闭合的 <!-- 不吞后文，每个都要往后找 `-->`：找不到的不能每次扫到末尾。
    ['一行里成串没闭合的 <!--', `${'x<!--'.repeat((BODY_LIMIT - 1) / 5)}x`],
  ];
  for (const [label, body] of adversarial) {
    test(`对抗性 body 线性解析：${label}，65,536 个字符在 200 ms 内`, () => {
      expect(body.length).toBe(BODY_LIMIT);
      const t0 = performance.now();
      parse(body);
      expect(performance.now() - t0).toBeLessThan(200);
    });
  }
});

// S4b（#1404 评论 6314008085 的路径安全项）：解码后的路径段里有 `/`（%2F）、`\\`、`?`、`#`、
// 换行、NUL 或别的控制字符的链接不算（列进 others）：raw 上这样的地址不是那个文件，外壳也
// 不拿它去 contents 探测。%2e%2e 解码成 `..` 段，同样不算。
describe('parseRawEvidenceLinks：解码后的路径段安全（S4b）', () => {
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

  test('假腿：空格、中文、加号这样的普通字符照常认', () => {
    expect(parse(raw('docs/verify/1404/01%20%E6%88%AA%E5%9B%BE+a.png')).links).toEqual([
      { sha: SHA, path: 'docs/verify/1404/01 截图+a.png' },
    ]);
  });
});

// S4b：readiness 与外壳共用的「合格链接」：钉在本 PR 的提交上、指向本 PR 增改的文件。
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

  test('提交在本 PR 里、文件是本 PR 增改的：合格，按 body 里的顺序', () => {
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

  test('提交不在本 PR 里、文件被本 PR 删掉、文件不在补丁里、别的票：都不合格', () => {
    const body = [
      raw('docs/verify/1404/a.png', OTHER),
      raw('docs/verify/1404/gone.png'),
      raw('docs/verify/1404/untouched.png'),
      raw('docs/verify/1405/a.png'),
    ].join(' ');
    expect(q(body)).toEqual([]);
  });
});
