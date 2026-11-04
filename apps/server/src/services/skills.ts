import {
  type Dirent,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  type Stats,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import {
  type CreateSkillBody,
  MAX_SKILL_FILE_BYTES,
  MAX_SKILL_TOTAL_BYTES,
  parseSkillFrontmatter,
  SKILL_DIR_NAME_RE,
  SKILL_ENTRY_FILE,
  type SkillFileBody,
  type SkillRecord,
  skillRecordSchema,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { skillAudit } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { NotFoundError } from './builds.js';

export interface LocalSkill {
  id: string;
  name: string;
  description: string | null;
  dirName: string;
}

export function scanLocalSkills(skillsDir: string): LocalSkill[] {
  let entryNames: string[];
  try {
    entryNames = readdirSync(skillsDir, { withFileTypes: true }).map((e) => e.name);
  } catch {
    return [];
  }
  const dirNames: string[] = [];
  for (const name of entryNames) {
    try {
      if (statSync(join(skillsDir, name)).isDirectory()) dirNames.push(name);
    } catch {}
  }
  dirNames.sort((a, b) => a.localeCompare(b));
  const out: LocalSkill[] = [];
  const seenReal = new Set<string>();
  const seenId = new Set<string>();
  for (const dirName of dirNames) {
    const dir = join(skillsDir, dirName);
    let real: string;
    try {
      real = realpathSync(dir);
    } catch {
      continue;
    }
    if (seenReal.has(real)) continue;
    let content: string;
    try {
      if (!readdirSync(dir).includes(SKILL_ENTRY_FILE)) continue;
      content = readFileSync(join(dir, SKILL_ENTRY_FILE), 'utf8');
    } catch {
      continue;
    }
    seenReal.add(real);
    const fm = parseSkillFrontmatter(content);
    const id = fm.name ?? dirName;
    if (seenId.has(id)) continue;
    seenId.add(id);
    out.push({ id, name: id, description: fm.description ?? null, dirName });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function resolveLocalSkill(
  skillsDir: string,
  id: string,
): { skill: LocalSkill; dir: string } | null {
  if (id === '' || id === '.' || id === '..' || id.includes('/') || id.includes('\\')) {
    return null;
  }
  const skill = scanLocalSkills(skillsDir).find((s) => s.id === id);
  if (!skill) return null;
  return { skill, dir: join(skillsDir, skill.dirName) };
}

export function listSkillFiles(skillDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        out.push(relative(skillDir, full).split(sep).join('/'));
      }
    }
  };
  walk(skillDir);
  return out.sort((a, b) => a.localeCompare(b));
}

function resolveSkillFileReal(skillDir: string, fileName: string): string | null {
  let root: string;
  try {
    root = realpathSync(resolve(skillDir));
  } catch {
    return null;
  }
  const target = resolve(root, fileName);
  if (target !== root && !target.startsWith(root + sep)) return null;
  if (target === root) return null;
  let real: string;
  let st: Stats;
  try {
    real = realpathSync(target);
    st = statSync(real);
  } catch {
    return null;
  }
  if (real !== root && !real.startsWith(root + sep)) return null;
  if (!st.isFile()) return null;
  return real;
}

export function readSkillFile(skillDir: string, fileName: string): string | null {
  const real = resolveSkillFileReal(skillDir, fileName);
  if (real === null) return null;
  const st = statSync(real);
  if (st.size > MAX_SKILL_FILE_BYTES) {
    throw new HttpError(
      400,
      `skill file too large: ${fileName} is ${st.size} bytes (limit ${MAX_SKILL_FILE_BYTES})`,
    );
  }
  return readFileSync(real, 'utf8');
}

export function readSkillFileBytes(skillDir: string, fileName: string): Buffer | null {
  const real = resolveSkillFileReal(skillDir, fileName);
  if (real === null) return null;
  return readFileSync(real);
}

export function filterKnownSkillIds(skillsDir: string, ids: string[]): string[] {
  const known = new Set(scanLocalSkills(skillsDir).map((s) => s.id));
  return ids.filter((id) => known.has(id));
}

export interface SkillAuditActor {
  type: 'member' | 'agent';
  id: string;
}

function assertSafeRelPath(path: string): void {
  if (
    path === '' ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')
  ) {
    throw new HttpError(
      400,
      `invalid files path ${JSON.stringify(path)}: expected a relative path inside the skill directory (posix separators, no . / .. segments)`,
    );
  }
}

function assertWriteFiles(files: SkillFileBody[]): number {
  const seen = new Set<string>();
  let total = 0;
  for (const file of files) {
    assertSafeRelPath(file.path);
    if (seen.has(file.path)) {
      throw new HttpError(400, `invalid body: duplicate file path ${file.path}`);
    }
    seen.add(file.path);
    const size = Buffer.byteLength(file.content, 'utf8');
    if (size > MAX_SKILL_FILE_BYTES) {
      throw new HttpError(
        400,
        `skill file too large: ${file.path} is ${size} bytes (limit ${MAX_SKILL_FILE_BYTES})`,
      );
    }
    total += size;
  }
  if (total > MAX_SKILL_TOTAL_BYTES) {
    throw new HttpError(
      400,
      `skill files too large: total ${total} bytes (limit ${MAX_SKILL_TOTAL_BYTES})`,
    );
  }
  return total;
}

function assertFrontmatterCoherence(
  entryContent: string,
  body: { name: string; description: string },
): { name: string; description: string } {
  const fm = parseSkillFrontmatter(entryContent);
  if (!fm.name) {
    throw new HttpError(
      400,
      'invalid SKILL.md frontmatter: name is required (one line, plain value)',
    );
  }
  if (!fm.description) {
    throw new HttpError(
      400,
      'invalid SKILL.md frontmatter: description is required (one line, plain value)',
    );
  }
  if (fm.name !== body.name) {
    throw new HttpError(
      400,
      `invalid body: name (body=${JSON.stringify(body.name)}, SKILL.md frontmatter=${JSON.stringify(fm.name)}) — SKILL.md frontmatter is the source of truth; they must match`,
    );
  }
  if (fm.description !== body.description) {
    throw new HttpError(
      400,
      `invalid body: description (body=${JSON.stringify(body.description)}, SKILL.md frontmatter=${JSON.stringify(fm.description)}) — SKILL.md frontmatter is the source of truth; they must match`,
    );
  }
  return { name: fm.name, description: fm.description };
}

function writeSkillFile(dir: string, file: SkillFileBody): void {
  const target = resolve(dir, file.path);
  if (target === dir || !target.startsWith(dir + sep)) {
    throw new HttpError(
      400,
      `invalid files path ${JSON.stringify(file.path)}: escapes the skill directory`,
    );
  }
  const segments = file.path.split('/');
  let cur = dir;
  for (const seg of segments.slice(0, -1)) {
    cur = join(cur, seg);
    let st: Stats;
    try {
      st = lstatSync(cur);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      throw new HttpError(
        400,
        `refusing to write through symlink: ${file.path} (${seg} is a symlink)`,
      );
    }
    if (!st.isDirectory()) {
      throw new HttpError(
        400,
        `invalid files path ${file.path}: ${seg} exists and is not a directory`,
      );
    }
  }
  let st: Stats | undefined;
  try {
    st = lstatSync(target);
  } catch {
    st = undefined;
  }
  if (st) {
    if (st.isSymbolicLink()) {
      throw new HttpError(400, `refusing to write through symlink: ${file.path}`);
    }
    if (!st.isFile()) {
      throw new HttpError(400, `invalid files path ${file.path}: target exists and is not a file`);
    }
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, file.content);
}

function insertSkillAudit(
  db: Db,
  row: {
    skillId: string;
    actor: SkillAuditActor;
    action: 'create' | 'update';
    bytes: number;
  },
): void {
  db.insert(skillAudit)
    .values({
      id: newRecordId(),
      skillId: row.skillId,
      actorType: row.actor.type,
      actorId: row.actor.id,
      action: row.action,
      bytes: row.bytes,
      createdAt: nowMs(),
    })
    .run();
}

export function createLocalSkill(
  opts: { db: Db; skillsDir: string; teamId: string; actor: SkillAuditActor },
  body: CreateSkillBody,
): SkillRecord {
  if (!SKILL_DIR_NAME_RE.test(body.name)) {
    throw new HttpError(
      400,
      `invalid body.name: expected a directory-safe skill name (starts with a letter or digit; letters, digits, dot, dash, underscore; 64 chars max), got ${JSON.stringify(body.name)}`,
    );
  }
  const bytes = assertWriteFiles(body.files);
  const entry = body.files.find((f) => f.path === SKILL_ENTRY_FILE);
  if (!entry) {
    throw new HttpError(
      400,
      `invalid body: files must include ${SKILL_ENTRY_FILE} (the skill entry file)`,
    );
  }
  const truth = assertFrontmatterCoherence(entry.content, body);
  const dir = join(opts.skillsDir, body.name);
  let occupied = true;
  try {
    statSync(dir);
  } catch {
    occupied = false;
  }
  if (occupied) {
    throw new HttpError(409, `skill directory ${body.name} already exists`);
  }
  const clash = scanLocalSkills(opts.skillsDir).find((s) => s.id === body.name);
  if (clash) {
    throw new HttpError(409, `skill id ${body.name} already exists (directory ${clash.dirName})`);
  }
  for (const file of body.files) writeSkillFile(dir, file);
  insertSkillAudit(opts.db, { skillId: truth.name, actor: opts.actor, action: 'create', bytes });
  return skillRecordSchema.parse({
    id: truth.name,
    teamId: opts.teamId,
    name: truth.name,
    description: truth.description,
  });
}

export function rollbackLocalSkillCreate(
  opts: { db: Db; skillsDir: string },
  skillId: string,
): void {
  rmSync(join(opts.skillsDir, skillId), { recursive: true, force: true });
  const rows = opts.db
    .select()
    .from(skillAudit)
    .where(and(eq(skillAudit.skillId, skillId), eq(skillAudit.action, 'create')))
    .all();
  const latest = rows.reduce<(typeof rows)[number] | undefined>(
    (best, row) => (best === undefined || row.createdAt >= best.createdAt ? row : best),
    undefined,
  );
  if (latest) opts.db.delete(skillAudit).where(eq(skillAudit.id, latest.id)).run();
}

export function updateLocalSkill(
  opts: { db: Db; skillsDir: string; teamId: string; actor: SkillAuditActor },
  skillId: string,
  body: CreateSkillBody,
): SkillRecord {
  const resolved = resolveLocalSkill(opts.skillsDir, skillId);
  if (!resolved) throw new NotFoundError(`skill ${skillId}`);
  const bytes = assertWriteFiles(body.files);
  const entry = body.files.find((f) => f.path === SKILL_ENTRY_FILE);
  let name: string;
  let description: string;
  if (entry) {
    const truth = assertFrontmatterCoherence(entry.content, body);
    name = truth.name;
    description = truth.description;
    if (name !== resolved.skill.id) {
      const clash = scanLocalSkills(opts.skillsDir).find(
        (s) => s.id === name && s.dirName !== resolved.skill.dirName,
      );
      if (clash) {
        throw new HttpError(409, `skill id ${name} already exists (directory ${clash.dirName})`);
      }
    }
  } else {
    if (body.name !== resolved.skill.id) {
      throw new HttpError(
        400,
        `invalid body: name (body=${JSON.stringify(body.name)}) does not match skill ${JSON.stringify(resolved.skill.id)} — include SKILL.md to rename`,
      );
    }
    if (body.description !== resolved.skill.description) {
      throw new HttpError(
        400,
        `invalid body: description (body=${JSON.stringify(body.description)}) does not match the skill frontmatter — include SKILL.md to change it`,
      );
    }
    name = resolved.skill.id;
    description = resolved.skill.description ?? body.description;
  }
  for (const file of body.files) writeSkillFile(resolved.dir, file);
  insertSkillAudit(opts.db, { skillId: name, actor: opts.actor, action: 'update', bytes });
  return skillRecordSchema.parse({
    id: name,
    teamId: opts.teamId,
    name,
    description,
  });
}
