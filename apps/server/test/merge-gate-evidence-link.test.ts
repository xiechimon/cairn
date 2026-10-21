// 合并就绪闸 S1（#1404）：PR body 里的 raw 证据链（AGENTS.md「验收必核 PR body
// 的证据 raw 永久链」）。只认钉 40 位小写 SHA、指向本仓 docs/verify/<票号>/ 的
// 链接；HTML 注释里的不算（与 scripts/pr-evidence-gate.py 同一约定）。

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

  test('目录穿越与仓外路径不算', () => {
    const r = parse(raw('docs/verify/1404/../1403/a.json'));
    expect(r.links).toEqual([]);
  });
});
