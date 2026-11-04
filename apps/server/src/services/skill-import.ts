import {
  type Dirent,
  readdirSync,
  readFileSync,
  realpathSync,
  type Stats,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import {
  type CreateSkillBody,
  type ImportSkillBody,
  MAX_SKILL_FILE_BYTES,
  MAX_SKILL_TOTAL_BYTES,
  parseSkillFrontmatter,
  SKILL_ENTRY_FILE,
  type SkillFileBody,
  type SkillRecord,
} from '@cairn/shared';
import type { Db } from '../db/client.js';
import { HttpError } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import { NotFoundError } from './builds.js';
import { readSkillSource, writeSkillSource } from './skill-source-store.js';
import {
  createLocalSkill,
  resolveLocalSkill,
  rollbackLocalSkillCreate,
  type SkillAuditActor,
  updateLocalSkill,
} from './skills.js';

export type SkillImportFetch = (
  input: string | URL,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export const SKILL_IMPORT_FETCH_TIMEOUT_MS = 15_000;

export const SKILL_IMPORT_DEADLINE_MS = 120_000;

export const SKILL_IMPORT_MAX_FILES = 256;

const GH_API_BASE = 'https://api.github.com';
const GH_RAW_BASE = 'https://raw.githubusercontent.com';
// GitHub rejects API requests without a User-Agent (403).
const GH_USER_AGENT = 'cairn-skill-import';
const GH_HEADERS: Record<string, string> = {
  'user-agent': GH_USER_AGENT,
  accept: 'application/vnd.github+json',
};

export interface SkillImportOpts {
  db: Db;
  skillsDir: string;
  skillSourcesPath: string;
  teamId: string;
  actor: SkillAuditActor;
  fetch: SkillImportFetch;
  timeoutMs?: number;
}

interface Collected {
  sourceRef: string;
  files: SkillFileBody[];
}

const utf8Strict = new TextDecoder('utf-8', { fatal: true });
function decodeUtf8Strict(bytes: Buffer, label: string): string {
  try {
    return utf8Strict.decode(bytes);
  } catch {
    throw new HttpError(
      400,
      `skill file is not valid UTF-8 text (binary files are not importable through this channel): ${label}`,
    );
  }
}

function assertFileBytes(label: string, size: number): void {
  if (size > MAX_SKILL_FILE_BYTES) {
    throw new HttpError(
      400,
      `skill file too large: ${label} is ${size} bytes (limit ${MAX_SKILL_FILE_BYTES})`,
    );
  }
}

function assembleCreateBody(files: SkillFileBody[], sourceLabel: string): CreateSkillBody {
  const entry = files.find((f) => f.path === SKILL_ENTRY_FILE);
  if (!entry) {
    throw new HttpError(
      400,
      `invalid source: no ${SKILL_ENTRY_FILE} found in ${sourceLabel} — a skill directory must contain it`,
    );
  }
  const fm = parseSkillFrontmatter(entry.content);
  if (!fm.name) {
    throw new HttpError(
      400,
      `invalid ${SKILL_ENTRY_FILE} frontmatter: name is required (one line, plain value)`,
    );
  }
  if (!fm.description) {
    throw new HttpError(
      400,
      `invalid ${SKILL_ENTRY_FILE} frontmatter: description is required (one line, plain value)`,
    );
  }
  return { name: fm.name, description: fm.description, files };
}

function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

function skillsRootReal(skillsDir: string): string {
  try {
    return realpathSync(resolve(skillsDir));
  } catch {
    return resolve(skillsDir);
  }
}

function collectFromLocalPath(rawPath: string, skillsDir: string): Collected {
  const resolved = resolve(expandHome(rawPath));
  let real: string;
  let st: Stats;
  try {
    real = realpathSync(resolved);
    st = statSync(real);
  } catch {
    throw new HttpError(400, `localPath not found: ${rawPath}`);
  }
  if (!st.isDirectory()) {
    throw new HttpError(400, `localPath is not a directory: ${rawPath}`);
  }
  const rootReal = skillsRootReal(skillsDir);
  if (real === rootReal || real.startsWith(rootReal + sep)) {
    throw new HttpError(
      400,
      `localPath ${rawPath} resolves inside the cairn skills directory (${skillsDir}) — it is already visible to cairn; import from a directory outside it`,
    );
  }
  const files: SkillFileBody[] = [];
  let total = 0;
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      throw new HttpError(400, `cannot read source directory: ${dir}`);
    }
    for (const entry of entries) {
      if (entry.name === '.git') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = relative(real, full).split(sep).join('/');
      let fileSt: Stats;
      try {
        fileSt = statSync(full);
      } catch {
        throw new HttpError(400, `cannot read source file: ${rel}`);
      }
      assertFileBytes(rel, fileSt.size);
      const bytes = readFileSync(full);
      files.push({ path: rel, content: decodeUtf8Strict(bytes, rel) });
      total += fileSt.size;
      if (total > MAX_SKILL_TOTAL_BYTES) {
        throw new HttpError(
          400,
          `skill files too large: total ${total} bytes (limit ${MAX_SKILL_TOTAL_BYTES})`,
        );
      }
    }
  };
  walk(real);
  return { sourceRef: real, files };
}

interface GithubTarget {
  owner: string;
  repo: string;
  ref?: string;
  subPath: string;
  canonicalUrl: string;
}

function isPrivateOrLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h === '0.0.0.0' || h === '::') return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return (
      a === 127 ||
      a === 0 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  if (h.includes(':')) {
    if (h === '::1') return true;
    const first = Number.parseInt(h.split(':')[0] ?? '0', 16);
    if (Number.isFinite(first)) {
      if ((first & 0xffc0) === 0xfe80) return true;
      if ((first & 0xfe00) === 0xfc00) return true;
    }
    const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
    if (mapped) {
      // biome-ignore lint/style/noNonNullAssertion: regex has one capture group, matched truthy above guarantees [1] defined
      return isPrivateOrLoopbackHost(mapped[1]!);
    }
  }
  return false;
}

const GH_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
const GH_REF_RE = /^[A-Za-z0-9._/-]+$/;

function parseGithubUrl(raw: string): GithubTarget {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new HttpError(400, `invalid url: ${raw}`);
  }
  if (u.protocol !== 'https:') {
    throw new HttpError(400, `invalid url: only https URLs are supported, got ${raw}`);
  }
  const host = u.hostname.toLowerCase();
  if (host !== 'github.com') {
    if (isPrivateOrLoopbackHost(host)) {
      throw new HttpError(
        400,
        `refusing to import from a private or loopback host: ${host} (${raw})`,
      );
    }
    throw new HttpError(
      400,
      `unsupported host: only GitHub URLs are supported (https://github.com/<owner>/<repo>[/tree/<ref>/<subdir>]), got ${raw}`,
    );
  }
  let segments: string[];
  try {
    segments = decodeURIComponent(u.pathname)
      .split('/')
      .filter((s) => s !== '');
  } catch {
    throw new HttpError(400, `invalid url encoding: ${raw}`);
  }
  if (segments.length < 2) {
    throw new HttpError(
      400,
      `unsupported GitHub URL shape: expected https://github.com/<owner>/<repo>[/tree/<ref>/<subdir>], got ${raw}`,
    );
  }
  // biome-ignore lint/style/noNonNullAssertion: segments.length < 2 throws above; [0] and [1] are defined here
  const [owner, repo] = [segments[0]!, segments[1]!];
  if (!GH_SEGMENT_RE.test(owner) || !GH_SEGMENT_RE.test(repo)) {
    throw new HttpError(400, `invalid GitHub owner/repo in url: ${raw}`);
  }
  let ref: string | undefined;
  let subSegments: string[];
  if (segments[2] === 'tree') {
    if (segments.length < 4) {
      throw new HttpError(
        400,
        `unsupported GitHub URL shape: tree form requires a ref (…/tree/<ref>/<subdir>), got ${raw}`,
      );
    }
    // biome-ignore lint/style/noNonNullAssertion: segments.length < 4 throws above; [3] is defined
    ref = segments[3]!;
    if (!GH_REF_RE.test(ref) || ref.split('/').some((seg) => seg === '.' || seg === '..')) {
      throw new HttpError(400, `invalid GitHub ref in url: ${raw}`);
    }
    subSegments = segments.slice(4);
  } else if (segments[2] === 'blob') {
    throw new HttpError(
      400,
      `unsupported GitHub URL shape: blob URLs point at a single file — use the tree/directory URL (…/tree/<ref>/<subdir>), got ${raw}`,
    );
  } else {
    subSegments = segments.slice(2);
  }
  if (
    subSegments.some(
      (seg) => seg === '.' || seg === '..' || seg.includes('\\') || seg.includes('\0'),
    )
  ) {
    throw new HttpError(400, `invalid subdirectory in url: ${raw}`);
  }
  const subPath = subSegments.join('/');
  const canonicalUrl =
    `https://github.com/${owner}/${repo}` +
    (ref !== undefined ? `/tree/${ref}` : '') +
    (subPath !== '' ? `/${subPath}` : '');
  return { owner, repo, ...(ref !== undefined ? { ref } : {}), subPath, canonicalUrl };
}

function mapFetchError(url: string, err: unknown): HttpError {
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return new HttpError(504, `fetch timed out: ${url}`);
  }
  return new HttpError(
    502,
    `fetch failed: ${url} (${err instanceof Error ? err.message : String(err)})`,
  );
}

async function fetchBytes(
  opts: SkillImportOpts,
  url: string,
  capBytes: number,
): Promise<{ ok: boolean; status: number; bytes: Buffer | null }> {
  const timeoutMs = opts.timeoutMs ?? SKILL_IMPORT_FETCH_TIMEOUT_MS;
  let res: Awaited<ReturnType<SkillImportFetch>>;
  try {
    res = await opts.fetch(url, { headers: GH_HEADERS, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw mapFetchError(url, err);
  }
  if (!res.ok) return { ok: false, status: res.status, bytes: null };
  const declared = res.headers.get('content-length');
  if (declared !== null) {
    const n = Number(declared);
    if (Number.isFinite(n) && n > capBytes) {
      throw new HttpError(400, `skill file too large: ${url} is ${n} bytes (limit ${capBytes})`);
    }
  }
  let buffer: ArrayBuffer;
  try {
    buffer = await res.arrayBuffer();
  } catch (err) {
    throw mapFetchError(url, err);
  }
  const bytes = Buffer.from(buffer);
  if (bytes.length > capBytes) {
    throw new HttpError(
      400,
      `skill file too large: ${url} is ${bytes.length} bytes (limit ${capBytes})`,
    );
  }
  return { ok: true, status: res.status, bytes };
}

async function fetchGithubJson<T>(
  opts: SkillImportOpts,
  url: string,
): Promise<{ status: number; body: T | null }> {
  const timeoutMs = opts.timeoutMs ?? SKILL_IMPORT_FETCH_TIMEOUT_MS;
  let res: Awaited<ReturnType<SkillImportFetch>>;
  try {
    res = await opts.fetch(url, { headers: GH_HEADERS, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw mapFetchError(url, err);
  }
  if (!res.ok) return { status: res.status, body: null };
  try {
    return { status: res.status, body: (await res.json()) as T };
  } catch {
    throw new HttpError(502, `GitHub API returned an unparsable body: ${url}`);
  }
}

function githubApiError(what: string, status: number): HttpError {
  if (status === 404) {
    return new HttpError(400, `GitHub ${what} not found (or private): see the import URL`);
  }
  return new HttpError(502, `GitHub API unavailable (status ${status}) — retry the import later`);
}

interface GhTreeEntry {
  path: string;
  type: string;
  size?: number;
}

async function collectFromGithubUrl(rawUrl: string, opts: SkillImportOpts): Promise<Collected> {
  const target = parseGithubUrl(rawUrl);
  const meta = await fetchGithubJson<{ default_branch?: unknown }>(
    opts,
    `${GH_API_BASE}/repos/${target.owner}/${target.repo}`,
  );
  if (meta.status !== 200) throw githubApiError(`repo ${target.owner}/${target.repo}`, meta.status);
  const defaultBranch =
    typeof meta.body?.default_branch === 'string' && meta.body.default_branch !== ''
      ? meta.body.default_branch
      : 'main';
  const ref = target.ref ?? defaultBranch;
  const tree = await fetchGithubJson<{ truncated?: boolean; tree?: GhTreeEntry[] }>(
    opts,
    `${GH_API_BASE}/repos/${target.owner}/${target.repo}/git/trees/${ref}?recursive=1`,
  );
  if (tree.status !== 200)
    throw githubApiError(`ref ${ref} of ${target.owner}/${target.repo}`, tree.status);
  if (tree.body?.truncated === true) {
    throw new HttpError(
      400,
      `repository tree too large (GitHub truncated the listing) — cannot import ${target.owner}/${target.repo}@${ref}; import a smaller subdirectory`,
    );
  }
  const prefix = target.subPath === '' ? '' : `${target.subPath}/`;
  const entries = (tree.body?.tree ?? [])
    .filter((e) => e.type === 'blob' && e.path.startsWith(prefix))
    .map((e) => ({ path: e.path.slice(prefix.length), size: e.size ?? 0 }))
    .sort((a, b) => a.path.localeCompare(b.path));
  if (entries.length > SKILL_IMPORT_MAX_FILES) {
    throw new HttpError(
      400,
      `import source has ${entries.length} files (limit ${SKILL_IMPORT_MAX_FILES})`,
    );
  }
  let total = 0;
  for (const entry of entries) {
    if (
      entry.path === '' ||
      entry.path.startsWith('/') ||
      entry.path.includes('\\') ||
      entry.path.includes('\0') ||
      entry.path.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')
    ) {
      throw new HttpError(400, `invalid file path in GitHub tree: ${entry.path}`);
    }
    assertFileBytes(entry.path, entry.size);
    total += entry.size;
    if (total > MAX_SKILL_TOTAL_BYTES) {
      throw new HttpError(
        400,
        `skill files too large: total ${total} bytes (limit ${MAX_SKILL_TOTAL_BYTES})`,
      );
    }
  }
  const deadline = Date.now() + SKILL_IMPORT_DEADLINE_MS;
  const files: SkillFileBody[] = [];
  for (const entry of entries) {
    if (Date.now() > deadline) {
      throw new HttpError(
        504,
        `import deadline exceeded while fetching files from ${target.canonicalUrl}`,
      );
    }
    const encoded = `${prefix}${entry.path}`.split('/').map(encodeURIComponent).join('/');
    const rawUrl = `${GH_RAW_BASE}/${target.owner}/${target.repo}/${ref}/${encoded}`;
    const res = await fetchBytes(opts, rawUrl, MAX_SKILL_FILE_BYTES);
    if (!res.ok) {
      if (res.status === 404) {
        throw new HttpError(400, `file missing at source: ${entry.path}`);
      }
      throw new HttpError(502, `GitHub raw fetch failed (status ${res.status}): ${entry.path}`);
    }
    // biome-ignore lint/style/noNonNullAssertion: res.ok guard above; fetchBytes returns bytes on the ok path
    files.push({ path: entry.path, content: decodeUtf8Strict(res.bytes!, entry.path) });
  }
  return { sourceRef: target.canonicalUrl, files };
}

export async function importSkill(
  opts: SkillImportOpts,
  body: ImportSkillBody,
): Promise<SkillRecord> {
  let collected: Collected;
  let kind: 'localPath' | 'github';
  if (body.localPath !== undefined && body.url === undefined) {
    kind = 'localPath';
    collected = collectFromLocalPath(body.localPath, opts.skillsDir);
  } else if (body.url !== undefined && body.localPath === undefined) {
    kind = 'github';
    collected = await collectFromGithubUrl(body.url, opts);
  } else {
    throw new HttpError(400, 'invalid body: exactly one of localPath or url is required');
  }
  const create = assembleCreateBody(
    collected.files,
    // biome-ignore lint/style/noNonNullAssertion: schema xor guarantees exactly one of localPath/url is set, mirrored by the if/else if above
    kind === 'localPath' ? body.localPath! : body.url!,
  );
  const record = createLocalSkill(
    { db: opts.db, skillsDir: opts.skillsDir, teamId: opts.teamId, actor: opts.actor },
    create,
  );
  try {
    await writeSkillSource(opts.skillSourcesPath, {
      skillId: record.id,
      kind,
      ref: collected.sourceRef,
      importedAt: nowMs(),
      refreshedAt: null,
    });
  } catch (err) {
    try {
      rollbackLocalSkillCreate({ db: opts.db, skillsDir: opts.skillsDir }, record.id);
    } catch (rollbackErr) {
      const cause = err instanceof Error ? err.message : String(err);
      const rollbackMessage =
        rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
      throw new HttpError(
        500,
        `skill source registration failed (${cause}) and removing the new skill directory failed (${rollbackMessage})`,
      );
    }
    throw err;
  }
  return record;
}

export async function refreshSkill(opts: SkillImportOpts, sid: string): Promise<SkillRecord> {
  const resolved = resolveLocalSkill(opts.skillsDir, sid);
  if (!resolved) throw new NotFoundError(`skill ${sid}`);
  const source = readSkillSource(opts.skillSourcesPath, sid);
  if (!source) {
    throw new HttpError(
      409,
      `skill ${JSON.stringify(sid)} has no recorded import source — only imported skills can be refreshed; import it again as a new skill instead`,
    );
  }
  let collected: Collected;
  try {
    if (source.kind === 'localPath') {
      collected = collectFromLocalPath(source.ref, opts.skillsDir);
    } else {
      collected = await collectFromGithubUrl(source.ref, opts);
    }
  } catch (err) {
    if (err instanceof HttpError && err.status === 400) {
      throw new HttpError(400, `cannot refresh skill ${JSON.stringify(sid)}: ${err.message}`);
    }
    throw err;
  }
  const update = assembleCreateBody(collected.files, source.ref);
  if (update.name !== sid) {
    throw new HttpError(
      409,
      `cannot refresh skill ${JSON.stringify(sid)}: the source skill identity drifted — its frontmatter name is now ${JSON.stringify(update.name)}; import it as a new skill instead`,
    );
  }
  const record = updateLocalSkill(
    { db: opts.db, skillsDir: opts.skillsDir, teamId: opts.teamId, actor: opts.actor },
    sid,
    update,
  );
  await writeSkillSource(opts.skillSourcesPath, { ...source, refreshedAt: nowMs() });
  return record;
}
