// 合并就绪闸 S1（#1404）：PR body 里的 raw 证据链（AGENTS.md「验收必核 PR body
// 的证据 raw 永久链」）。只认钉 40 位小写 SHA、指向本仓 docs/verify/<票号>/ 的
// 链接；HTML 注释里的不算（与 scripts/pr-evidence-gate.py 同一约定）。
// 第三轮补的：查询串与片段（?raw=true、#L3）不是路径的一部分。
// 第四轮钉住的：票号是另一票号的前缀时（14040 与 1404）不算本票证据。

import { describe, expect, test } from 'vitest';
import { parseRawEvidenceLinks } from '../src/services/merge-gate/evidence-link.js';

const SHA = 'f44b920639de983be1e050899e5217509204b43f';
const raw = (path: string, sha = SHA, slug = 'xiechimon/pacman') =>
  `https://raw.githubusercontent.com/${slug}/${sha}/${path}`;
const parse = (body: string, ticketRef = '1404') =>
  parseRawEvidenceLinks(body, { owner: 'xiechimon', repo: 'pacman', ticketRef });

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
      raw('docs/verify/1404/a.json', SHA, 'someone/pacman'),
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
    expect(parse(raw('docs/verify/1404/a.json', SHA, 'XieChimon/Pacman')).links).toHaveLength(1);
  });

  test('HTML 注释里的链接不算', () => {
    const body = `<!-- ${raw('docs/verify/1404/a.json')} -->\nno links`;
    expect(parse(body)).toEqual({ links: [], others: [] });
  });

  test('同一链接出现两次只记一次', () => {
    const url = raw('docs/verify/1404/a.json');
    expect(parse(`${url}\n[a](${url})`).links).toHaveLength(1);
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

  test('没闭合的 HTML 注释吞掉后文（GitHub 不渲染），其中的链接不算', () => {
    const body = `ok\n<!-- draft\n${raw('docs/verify/1404/a.json')}`;
    expect(parse(body)).toEqual({ links: [], others: [] });
  });

  test('目录穿越与仓外路径不算', () => {
    const r = parse(raw('docs/verify/1404/../1403/a.json'));
    expect(r.links).toEqual([]);
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
});
