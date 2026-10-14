// 技能导入通道（#1170）：POST /api/teams/{id}/skills/import（localPath /
// GitHub URL 二选一）+ POST /api/teams/{id}/skills/{sid}/refresh 重拉。
// 落盘一律复用 createLocalSkill/updateLocalSkill 既有校验（目录名安全正则 /
// frontmatter 唯一真值 / 字节闸 / 审计行）——本模块只做「把来源变成
// CreateSkillBody」这一件事，不另开写路径。
//
// 安全边界（票面硬要求，非形式主义）：
// - SSRF：URL 分支的用户输入只作「规格」不作「抓取目标」——实际出站仅
//   打到固定 host（api.github.com / raw.githubusercontent.com），URL 里
//   的 owner/repo/ref/子路径都先过字符白名单再拼进固定模板。输入校验仍
//   显式拒非 https 与私网/回环/link-local host（给贴错内网地址的用户
//   明确报错，而不是含糊的「不支持」）。
// - localPath：resolve+realpath 归一；归一后落在技能根内（含根本身）=
//   400——技能根已被 pacman 现扫管理，自指导入无意义；根外任意可读目录
//   是 local 形态的信任面（server 进程权限 = 操作者本人）。
// - 只读复制：源目录零写入；walk 不追符号链接（listSkillFiles 同律，
//   链接文件不入包）；.git 目录（VCS 元数据）不入包。
// - 二进制：写面 body 是 utf8 文本（CreateSkillBody content: string），
//   非 utf8 文件显式 400 点名——不静默丢弃（Multica 的 PG TEXT 列同因
//   选择跳过；pacman 写面纪律是显式拒绝，走私一个缺资产的半技能更糟）。
//
// 上限：单文件/总量沿用 shared MAX_SKILL_FILE_BYTES / MAX_SKILL_TOTAL_BYTES
// （写面闸在 createLocalSkill；URL 分支先用树声明的 size 预检——超限在
// 拉取前拒绝，不为废包花网络）。文件数上限 256 [设计]（Multica
// maxImportFileCount 同量级）：URL 分支每个文件一次出站请求，无上限 =
// 一个 10k 文件的目录能把导入变成慢速放）。

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
} from '@pacman/shared';
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

/** URL 分支出站 fetch（globalThis.fetch 结构子集 + arrayBuffer——raw 拉取
 * 要原始字节做 utf8 严格解码与真实尺寸闸；测试注入 mock）。 */
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

/** 单请求出站超时 [设计]：15s 覆盖 GitHub API/raw 的正常尾延迟；超时 =
 * 504 显式报错（票面「拉取超时显式报错」）。 */
export const SKILL_IMPORT_FETCH_TIMEOUT_MS = 15_000;

/** 单次导入整体截止 [设计]：256 文件 × 15s 的理论最坏不设限会拖死请求；
 * 截止后剩余文件不再拉取，504 报错。 */
export const SKILL_IMPORT_DEADLINE_MS = 120_000;

/** URL 分支文件数上限（每个文件一次出站请求——见头注）。 */
export const SKILL_IMPORT_MAX_FILES = 256;

const GH_API_BASE = 'https://api.github.com';
const GH_RAW_BASE = 'https://raw.githubusercontent.com';
/** GitHub API 要求 User-Agent（无 UA = 403）；自报家门 = pacman 导入通道。 */
const GH_USER_AGENT = 'pacman-skill-import';
const GH_HEADERS: Record<string, string> = {
  'user-agent': GH_USER_AGENT,
  accept: 'application/vnd.github+json',
};

export interface SkillImportOpts {
  db: Db;
  skillsDir: string;
  /** 来源登记文件（config 数据根 skill-sources.json）。 */
  skillSourcesPath: string;
  teamId: string;
  actor: SkillAuditActor;
  /** URL 分支出站（缺省 globalThis.fetch）。 */
  fetch: SkillImportFetch;
  /** 单请求超时（测试注入；缺省 SKILL_IMPORT_FETCH_TIMEOUT_MS）。 */
  timeoutMs?: number;
}

/** 收集产物：来源引用（登记/refresh 用）+ 写面 body 原料。 */
interface Collected {
  sourceRef: string;
  files: SkillFileBody[];
}

// —— 通用件（两分支共用）———————————————————————————————————————————

/** utf8 严格解码（二进制显式拒绝，见头注）。 */
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

/** 单文件字节闸（与 createLocalSkill 同文案口径，收集面提前拒绝）。 */
function assertFileBytes(label: string, size: number): void {
  if (size > MAX_SKILL_FILE_BYTES) {
    throw new HttpError(
      400,
      `skill file too large: ${label} is ${size} bytes (limit ${MAX_SKILL_FILE_BYTES})`,
    );
  }
}

/** frontmatter 是唯一真值：导入/refresh 的 body.name/description 取自
 * SKILL.md frontmatter（body 声明只是与之对拍的冗余——createLocalSkill/
 * updateLocalSkill 闸同律重验）。缺 name/description = 400 点名。 */
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

// —— localPath 分支 ————————————————————————————————————————————————

/** `~` 前缀展开（与 config.ts skillsDir 同形；web 表单贴 ~ 路径友好）。 */
function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

/** realpath 归一的技能根（缺失 = resolve 形——空根不可能有「根内」路径）。 */
function skillsRootReal(skillsDir: string): string {
  try {
    return realpathSync(resolve(skillsDir));
  } catch {
    return resolve(skillsDir);
  }
}

/** 源目录收集：只读 walk（lstat 语义不追符号链接、跳 .git）、逐文件字节闸
 * + utf8 严格解码、运行总量闸。读失败 = 400 显式（写面纪律，不静默跳过）。 */
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
      `localPath ${rawPath} resolves inside the pacman skills directory (${skillsDir}) — it is already visible to pacman; import from a directory outside it`,
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
      if (entry.name === '.git') continue; // VCS 元数据不入包
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue; // 符号链接/特殊文件不入包（listSkillFiles 同律）
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

// —— URL 分支（GitHub 公共仓/子目录）———————————————————————————————————

/** GitHub URL 解析产物。ref 缺省 = 默认分支（repo meta 拉取后回填）。 */
interface GithubTarget {
  owner: string;
  repo: string;
  ref?: string;
  subPath: string;
  canonicalUrl: string;
}

/** 私网/回环/link-local 判定（SSRF 拒绝面；v4 字面 + v6 字面 + localhost
 * 族——DNS 解析不在此层：真实出站只打固定 GitHub host，见头注）。 */
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
    // v6 字面：::1 / fe80::/10 / fc00::/7 / v4 映射 ::ffff:a.b.c.d
    if (h === '::1') return true;
    const first = Number.parseInt(h.split(':')[0] ?? '0', 16);
    if (Number.isFinite(first)) {
      if ((first & 0xffc0) === 0xfe80) return true; // link-local
      if ((first & 0xfe00) === 0xfc00) return true; // unique-local
    }
    const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
    if (mapped) return isPrivateOrLoopbackHost(mapped[1]!);
  }
  return false;
}

/** owner/repo 段白名单（URL 段注入固定 host 模板的防线）。 */
const GH_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
/** ref 白名单：分支名可含斜杠（feature/x）；拒绝 `..` 段。 */
const GH_REF_RE = /^[A-Za-z0-9._/-]+$/;

/** GitHub URL 解析 + 全部输入校验（scheme/SSRF/形状/段字符）。 */
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
  // 子路径段守卫：`.`/`..`/反斜杠/NUL = 逃逸形态（正规树条目不会有，纵深
  // 防御）；其余字符不设限（真实子目录名可含 unicode/空格）。
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

/** 出站请求错误归类（超时/中断 = 504；网络失败 = 502；其余由调用方按
 * status 分派）。 */
function mapFetchError(url: string, err: unknown): HttpError {
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return new HttpError(504, `fetch timed out: ${url}`);
  }
  return new HttpError(
    502,
    `fetch failed: ${url} (${err instanceof Error ? err.message : String(err)})`,
  );
}

/** 出站 GET（超时 + 上限读）。res.ok 之外的分派归调用方（repo/tree/raw 的
 * 404 语义各不相同）。字节上限 = content-length 预检 + 读后实检。 */
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

/** GitHub API JSON GET（200 = body；404/403/429 分派在调用方）。 */
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

/** API 层错误分派：404 = 源不存在（400 点名，导入输入错）；401/403/429 =
 * 源暂不可用（502——限流/鉴权面，重试可解）。 */
function githubApiError(what: string, status: number): HttpError {
  if (status === 404) {
    return new HttpError(400, `GitHub ${what} not found (or private): see the import URL`);
  }
  return new HttpError(502, `GitHub API unavailable (status ${status}) — retry the import later`);
}

/** git tree 条目（API 响应形子集）。 */
interface GhTreeEntry {
  path: string;
  type: string;
  size?: number;
}

/** URL 分支收集：repo meta（默认分支）→ recursive tree（子目录过滤 + 全部
 * 预检）→ 逐文件 raw 拉取（超时/上限/utf8）。来源引用 = canonical URL。 */
async function collectFromGithubUrl(rawUrl: string, opts: SkillImportOpts): Promise<Collected> {
  const target = parseGithubUrl(rawUrl);
  // repo meta：存在性 + 默认分支（无 tree 段的 URL 用它）。
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
  // recursive tree。
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
  // 树条目路径守卫（逃逸形拒绝——票面「归档路径逃逸」）+ 尺寸预检（拉取前）。
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
  // 逐文件 raw 拉取（整体截止：理论最坏 256 × 15s 不设限会拖死请求）。
  // raw URL 用树里的完整路径（子目录前缀在树路径上，不在 relPath 上——写面
  // body 的 path 才是子目录相对形）。
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
    files.push({ path: entry.path, content: decodeUtf8Strict(res.bytes!, entry.path) });
  }
  return { sourceRef: target.canonicalUrl, files };
}

// —— 编排（import / refresh）——————————————————————————————————————————

/** 导入：收集 → createLocalSkill（全部既有校验/审计）→ 来源登记。
 * 201 的 record 即 createLocalSkill 产物（id = frontmatter name = 目录名）。
 * 登记失败则删掉刚建的目录和对应 create 审计行，调用方看到的仍是登记
 * 错误；同名可以再导入。 */
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
    // schema xor 已挡（纵深防御——服务层直调者也不该绕过）。
    throw new HttpError(400, 'invalid body: exactly one of localPath or url is required');
  }
  const create = assembleCreateBody(
    collected.files,
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

/** refresh：按登记来源重拉 → 身份不变闸（frontmatter name 必须仍等于 sid）
 * → updateLocalSkill 覆写语义（列出者覆写、未列者保留——源删的文件本地
 * 保留，与手动 PUT 同律，票面指定复用）。无来源 = 409；未知 sid = 404。
 * refreshedAt 落盘失败时内容已经覆写，来源文件仍是上一次成功的记录，
 * 再 refresh 一次即可补上时间戳。 */
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
      // 收集面 400（源丢失/二进制/超限）带上技能语境——报错要能定位到技能。
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
