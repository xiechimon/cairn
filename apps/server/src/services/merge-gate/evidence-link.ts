// PR body 里的 raw 证据链（#1404；AGENTS.md「验收必核 PR body 的证据 raw
// 永久链」）。只认钉 40 位小写 SHA、指向本仓 docs/verify/<票号>/ 的链接：分支
// 名会动，短 SHA 与大写写法不是 verify-cairn 打印的 raw 链接的形态，别的仓、
// 别的票不算本票证据。HTML 注释里的链接不渲染，也不算（与
// scripts/pr-evidence-gate.py 同一约定）。没闭合的 `<!--` 在行首（至多三个空格
// 缩进）开一个 HTML 块（cmark-gfm 第 2 类），GitHub 吞掉后文，后文也不算；在行中
// 的（比如反引号里引用它）只是字面文字，不吞。`<!-->` 与
// `<!--->` 是空注释：HTML 与 cmark-gfm 都在这个 `-->` 处结束，所以闭合从 `<!--`
// 的第三个字符起找。链接后紧跟的句读与反引号不算进路径，查询串与片段
// （`?raw=true`、`#L3`）也不算：去掉后路径合格照样认。同一文件（解码后的
// sha 与路径；仓主大小写、`%61` 不同的写法是同一份）只记一次。SHA 是否是 head
// 的祖先由调用方另查（compare），这里只解析。
// body 由作者控制（最长 65,536 个字符），解析必须线性：注释与链接尾部的句读用
// 手写的前向扫描；剩下的正则至多一个不定长量词、且排在末尾，不会回溯。
// 闭合的注释换成一个空格而不是删掉：被注释切开的 URL 在 GitHub 上是两截，
// 不能拼回一条链接（pr-evidence-gate.py 同样把注释换成空白）。

import { EVIDENCE_PREFIX } from '@cairn/shared/merge-gate';

export interface RawEvidenceLink {
  sha: string;
  /** 解码后的仓内路径，如 docs/verify/1404/result.json。 */
  path: string;
}

const RAW_URL_RE = /https:\/\/raw\.githubusercontent\.com\/[^\s)"'<>\]`]+/g;
const QUERY_OR_FRAGMENT_RE = /[?#]/;
const TRAILING_PUNCT = '.,;:!?*_~';

/** `<!--` 在行首、前面至多三个空格：cmark-gfm 第 2 类 HTML 块的开头。往回至多看
 * 四个字符。 */
function opensHtmlBlock(body: string, open: number): boolean {
  let i = open;
  while (i > 0 && open - i < 3 && body.charAt(i - 1) === ' ') i -= 1;
  return i === 0 || body.charAt(i - 1) === '\n';
}

/** 闭合的 `<!-- ... -->` 换成一个空格（每段到从 `<!--` 的第三个字符起最近的 `-->`
 * 为止，`<!-->`、`<!--->` 即空注释）。没闭合的 `<!--` 开 HTML 块时，它起的后文全部
 * 丢掉；在行中时是字面文字，照留，接着往后找。每次 indexOf 都从上一次停下的位置往
 * 后找；最后一个 `-->` 的位置先取一次，没闭合的 `<!--` 不再往后扫。 */
function visibleText(body: string): string {
  const lastClose = body.lastIndexOf('-->');
  const parts: string[] = [];
  let pos = 0;
  let from = 0;
  for (;;) {
    const open = body.indexOf('<!--', from);
    if (open === -1) {
      parts.push(body.slice(pos));
      return parts.join(' ');
    }
    const close = open + 2 <= lastClose ? body.indexOf('-->', open + 2) : -1;
    if (close !== -1) {
      parts.push(body.slice(pos, open));
      pos = close + 3;
      from = pos;
    } else if (opensHtmlBlock(body, open)) {
      parts.push(body.slice(pos, open));
      return parts.join(' ');
    } else {
      from = open + 4;
    }
  }
}

function withoutTrailingPunct(url: string): string {
  let end = url.length;
  while (end > 0 && TRAILING_PUNCT.includes(url.charAt(end - 1))) end -= 1;
  return url.slice(0, end);
}

/** 解码后的段里不收的字符（S4b，#1404 评论 6314008085）：`/`（%2F 把一段拆成两段或拼出目录）、
 * `\\`、`?`、`#` 与控制字符（含换行、NUL）。raw 上这样的地址不是那个文件，外壳也不拿它去
 * contents 探测。 */
const UNSAFE_DECODED = /[/\\?#\p{Cc}]/u;

/** 逐段 URL 解码再用 `/` 连起来；坏的百分号转义（`%E0%A4%A`）或解码后有不收的字符返回 null。 */
function decodedPath(segments: readonly string[]): string | null {
  try {
    const decoded = segments.map((p) => decodeURIComponent(p));
    return decoded.some((d) => UNSAFE_DECODED.test(d)) ? null : decoded.join('/');
  } catch {
    return null;
  }
}

export function parseRawEvidenceLinks(
  body: string,
  args: { owner: string; repo: string; ticketRef: string },
): { links: RawEvidenceLink[]; others: string[] } {
  const links: RawEvidenceLink[] = [];
  const others: string[] = [];
  // 合格的链接按 `${sha}/${path}` 去重，其余按去掉查询串与片段后的 URL 原文；
  // 前者以 40 位 hex 开头、后者以 https:// 开头，两种键撞不上。
  const seen = new Set<string>();
  const slug = `${args.owner}/${args.repo}`.toLowerCase();
  const ownDir = `${EVIDENCE_PREFIX}${args.ticketRef}/`;

  for (const url of (visibleText(body).match(RAW_URL_RE) ?? []).map(withoutTrailingPunct)) {
    const cut = url.search(QUERY_OR_FRAGMENT_RE);
    const bare = cut === -1 ? url : url.slice(0, cut);
    const parts = bare.slice('https://raw.githubusercontent.com/'.length).split('/');
    const [owner = '', repo = '', sha = '', ...rest] = parts;
    const path = decodedPath(rest);
    const ok =
      path !== null &&
      `${owner}/${repo}`.toLowerCase() === slug &&
      /^[0-9a-f]{40}$/.test(sha) &&
      path.startsWith(ownDir) &&
      !path.split('/').some((seg) => seg === '..' || seg === '.' || seg === '');
    const key = ok ? `${sha}/${path}` : bare;
    if (seen.has(key)) continue;
    seen.add(key);
    if (ok) links.push({ sha, path });
    else others.push(url);
  }
  return { links, others };
}

/** 合格的证据链（S4b；readiness 与外壳共用这一条）：钉在本 PR 的提交上（compare 的 commits），
 * 指向本 PR 增改的文件（compare 的 files，删掉的不算）。只是 head 的祖先不够：main 历史里
 * 同票前一段（已 squash）的证据也是祖先，本 PR 却一份证据没加。按 body 里的顺序。 */
export function qualifyingEvidenceLinks(
  body: string,
  args: { owner: string; repo: string; ticketRef: string },
  compare: {
    commits: readonly { sha: string }[];
    files: readonly { status: string; filename: string }[];
  },
): RawEvidenceLink[] {
  const commits = new Set(compare.commits.map((c) => c.sha));
  const changed = new Set(
    compare.files.filter((f) => f.status !== 'removed').map((f) => f.filename),
  );
  return parseRawEvidenceLinks(body, args).links.filter(
    (l) => commits.has(l.sha) && changed.has(l.path),
  );
}
