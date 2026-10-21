// PR body 里的 raw 证据链（#1404；AGENTS.md「验收必核 PR body 的证据 raw
// 永久链」）。只认钉 40 位小写 SHA、指向本仓 docs/verify/<票号>/ 的链接：分支
// 名会动，短 SHA 与大写写法不是 vp.mjs links 产出的形态，别的仓、别的票不算
// 本票证据。HTML 注释里的链接不渲染，也不算（与 scripts/pr-evidence-gate.py
// 同一约定）；没闭合的 `<!--` 让 GitHub 吞掉后文，后文也不算。链接后紧跟的
// 句读与反引号不算进路径，查询串与片段（`?raw=true`、`#L3`）也不算：去掉后
// 路径合格照样认，同一文件只记一次。SHA 是否是 head 的祖先由调用方另查
// （compare），这里只解析。
// body 由作者控制（最长 65,536 个字符），解析必须线性：注释与链接尾部的句读用
// 手写的前向扫描；剩下的正则至多一个不定长量词、且排在末尾，不会回溯。
// 闭合的注释换成一个空格而不是删掉：被注释切开的 URL 在 GitHub 上是两截，
// 不能拼回一条链接（pr-evidence-gate.py 同样把注释换成空白）。

import { EVIDENCE_PREFIX } from '@pacman/shared';

export interface RawEvidenceLink {
  sha: string;
  /** 解码后的仓内路径，如 docs/verify/1404/result.json。 */
  path: string;
}

const RAW_URL_RE = /https:\/\/raw\.githubusercontent\.com\/[^\s)"'<>\]`]+/g;
const QUERY_OR_FRAGMENT_RE = /[?#]/;
const TRAILING_PUNCT = '.,;:!?*_~';

/** 闭合的 `<!-- ... -->` 换成一个空格（每段到它之后最近的 `-->` 为止）；第一个
 * 没闭合的 `<!--` 起的后文全部丢掉。每次 indexOf 都从上一次停下的位置往后找。 */
function visibleText(body: string): string {
  const parts: string[] = [];
  let pos = 0;
  for (;;) {
    const open = body.indexOf('<!--', pos);
    const close = open === -1 ? -1 : body.indexOf('-->', open + 4);
    if (close === -1) {
      parts.push(body.slice(pos, open === -1 ? body.length : open));
      return parts.join(' ');
    }
    parts.push(body.slice(pos, open));
    pos = close + 3;
  }
}

function withoutTrailingPunct(url: string): string {
  let end = url.length;
  while (end > 0 && TRAILING_PUNCT.includes(url.charAt(end - 1))) end -= 1;
  return url.slice(0, end);
}

export function parseRawEvidenceLinks(
  body: string,
  args: { owner: string; repo: string; ticketRef: string },
): { links: RawEvidenceLink[]; others: string[] } {
  const links: RawEvidenceLink[] = [];
  const others: string[] = [];
  const seen = new Set<string>();
  const slug = `${args.owner}/${args.repo}`.toLowerCase();
  const ownDir = `${EVIDENCE_PREFIX}${args.ticketRef}/`;

  for (const url of (visibleText(body).match(RAW_URL_RE) ?? []).map(withoutTrailingPunct)) {
    const cut = url.search(QUERY_OR_FRAGMENT_RE);
    const bare = cut === -1 ? url : url.slice(0, cut);
    if (seen.has(bare)) continue;
    seen.add(bare);
    const parts = bare.slice('https://raw.githubusercontent.com/'.length).split('/');
    const [owner = '', repo = '', sha = '', ...rest] = parts;
    let path: string;
    try {
      path = rest.map((p) => decodeURIComponent(p)).join('/');
    } catch {
      others.push(url);
      continue;
    }
    const ok =
      `${owner}/${repo}`.toLowerCase() === slug &&
      /^[0-9a-f]{40}$/.test(sha) &&
      path.startsWith(ownDir) &&
      !path.split('/').some((seg) => seg === '..' || seg === '.' || seg === '');
    if (ok) links.push({ sha, path });
    else others.push(url);
  }
  return { links, others };
}
