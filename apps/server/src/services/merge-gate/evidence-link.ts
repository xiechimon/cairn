// PR body 里的 raw 证据链（#1404；AGENTS.md「验收必核 PR body 的证据 raw
// 永久链」）。只认钉 40 位小写 SHA、指向本仓 docs/verify/<票号>/ 的链接：分支
// 名会动，短 SHA 与大写写法不是 vp.mjs links 产出的形态，别的仓、别的票不算
// 本票证据。HTML 注释里的链接不渲染，也不算（与 scripts/pr-evidence-gate.py
// 同一约定）；没闭合的 `<!--` 让 GitHub 吞掉后文，后文也不算。链接后紧跟的
// 句读与反引号不算进路径，查询串与片段（`?raw=true`、`#L3`）也不算：去掉后
// 路径合格照样认，同一文件只记一次。SHA 是否是 head 的祖先由调用方另查
// （compare），这里只解析。

import { EVIDENCE_PREFIX } from '@pacman/shared';

export interface RawEvidenceLink {
  sha: string;
  /** 解码后的仓内路径，如 docs/verify/1404/result.json。 */
  path: string;
}

const RAW_URL_RE = /https:\/\/raw\.githubusercontent\.com\/[^\s)"'<>\]`]+/g;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const TRAILING_PUNCT_RE = /[.,;:!?*_~]+$/;
const QUERY_OR_FRAGMENT_RE = /[?#].*$/;

export function parseRawEvidenceLinks(
  body: string,
  args: { owner: string; repo: string; ticketRef: string },
): { links: RawEvidenceLink[]; others: string[] } {
  const links: RawEvidenceLink[] = [];
  const others: string[] = [];
  const seen = new Set<string>();
  const slug = `${args.owner}/${args.repo}`.toLowerCase();
  const ownDir = `${EVIDENCE_PREFIX}${args.ticketRef}/`;

  const visible = body.replace(HTML_COMMENT_RE, '');
  const open = visible.indexOf('<!--');
  const text = open === -1 ? visible : visible.slice(0, open);
  for (const url of (text.match(RAW_URL_RE) ?? []).map((u) => u.replace(TRAILING_PUNCT_RE, ''))) {
    const bare = url.replace(QUERY_OR_FRAGMENT_RE, '');
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
