import { EVIDENCE_PREFIX } from '@cairn/shared/merge-gate';

export interface RawEvidenceLink {
  sha: string;
  path: string;
}

const RAW_URL_RE = /https:\/\/raw\.githubusercontent\.com\/[^\s)"'<>\]`]+/g;
const QUERY_OR_FRAGMENT_RE = /[?#]/;
const TRAILING_PUNCT = '.,;:!?*_~';

function opensHtmlBlock(body: string, open: number): boolean {
  let i = open;
  while (i > 0 && open - i < 3 && body.charAt(i - 1) === ' ') i -= 1;
  return i === 0 || body.charAt(i - 1) === '\n';
}

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

const UNSAFE_DECODED = /[/\\?#\p{Cc}]/u;

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
