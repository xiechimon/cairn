// skills 领域服务（spec 13 资源面本地化，#367 T1）——本地目录现扫投影 +
// XMON-109 S1 写路径（spec 13 回摆）。每个含 SKILL.md 的一级子目录 = 一个
// 技能；不入库、无缓存，每次请求现扫。写面三入口（REST / worker relay /
// chief relay）同落 createLocalSkill/updateLocalSkill，双动作均落 skill_audit
// 审计行。
// 身份模型（2026-09-29 合同修订，对齐 spec 14 daemon 注入契约）：
// id = SKILL.md frontmatter name，无 frontmatter / 无 name 回落目录名
// （agentskills.io / pi v0.86.0 同律：frontmatter.name 主键）。写面同律：
// frontmatter 是唯一真值——create 的 body 声明须与 frontmatter 一致；
// update 改名只能携带新 SKILL.md（目录不动、id 随 frontmatter 走）。
// 去重（同律）：realpath 相同（符号链接别名）只算一条；id 冲突 = 目录名
// 字典序先者胜 [设计]（确定性，无静默双条）。
// 容错（spec 13 premortem 护栏）：技能根缺失/不可读 = 空集不炸 server；
// 单目录读取失败（SKILL.md 中途消失/是目录/无权限）= 跳过该条不炸全局
// （读面容错律只约束读——写面校验失败一律 400/409 显式拒绝，不静默）。
//
// frontmatter 解析 = 最小解析器 [设计]（XMON-114 起单源在 shared records/
// skill.ts 的 parseSkillFrontmatter——web 编辑面预填/回读对拍与 server 写面
// 校验消费同一解析器；SKILL_DIR_NAME_RE 目录名安全域同位上提）。

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

/** 现扫产物（wire SkillRecord 的 server 内部形——dirName 供 detail/file
 * 端点解析盘位，不出 wire）。 */
export interface LocalSkill {
  /** 身份键：frontmatter name，回落目录名（agent.skills[] 同值域）。 */
  id: string;
  /** 显示名 = 与 id 同源（frontmatter name 回落目录名）。 */
  name: string;
  description: string | null;
  /** 所在目录名（技能根的一级子目录）。 */
  dirName: string;
}

/** 现扫技能根：一级子目录（含符号链接目录）中 SKILL.md 在盘者各出一条，
 * 输出按 id 字典序（确定性 wire 序）。任何 fs 失败 = 空集/跳过（头注容错律）。 */
export function scanLocalSkills(skillsDir: string): LocalSkill[] {
  let entryNames: string[];
  try {
    entryNames = readdirSync(skillsDir, { withFileTypes: true }).map((e) => e.name);
  } catch {
    return []; // 根缺失 / 非目录 / 不可读 = 空集（不炸）
  }
  const dirNames: string[] = [];
  for (const name of entryNames) {
    try {
      // statSync 跟随符号链接：链接目录同律收录（realpath 去重在下游）。
      if (statSync(join(skillsDir, name)).isDirectory()) dirNames.push(name);
    } catch {
      // 中途消失/坏链接 = 跳过
    }
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
    if (seenReal.has(real)) continue; // 符号链接别名 = 同一技能
    let content: string;
    try {
      // canon 名精确匹配（SKILL_ENTRY_FILE）：大小写不敏感文件系统（macOS/
      // Windows）上 readFileSync('SKILL.md') 会命中 skill.md——先 readdir
      // 验名录里确有精确大小写条目，再读。
      if (!readdirSync(dir).includes(SKILL_ENTRY_FILE)) continue;
      content = readFileSync(join(dir, SKILL_ENTRY_FILE), 'utf8');
    } catch {
      continue; // 无 SKILL.md / 不可读（中途消失、是目录、无权限）= 不是技能
    }
    seenReal.add(real);
    const fm = parseSkillFrontmatter(content);
    const id = fm.name ?? dirName;
    if (seenId.has(id)) continue; // id 冲突 = 目录名序先者胜 [设计]
    seenId.add(id);
    out.push({ id, name: id, description: fm.description ?? null, dirName });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** id → 技能 + 盘位（detail/file 端点用）。未知 id / 不安全段 = null（路由
 * 面 404；sid 是 URL 段，虽经 scan 匹配仍显式挡 `..`、分隔符——纵深防御）。 */
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

/** 技能目录文件清单（相对路径、posix 分隔、含 SKILL.md 自身，字典序）。
 * 递归 walk；单条目失败跳过（容错律同 scan）。 */
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
      // 符号链接/特殊文件不入清单（文本投影面只对常规文件诚实 [设计]）
    }
  };
  walk(skillDir);
  return out.sort((a, b) => a.localeCompare(b));
}

/** 技能目录内单文件解析（双道守卫单源，readSkillFile / readSkillFileBytes
 * 共用）：文本 resolve 前缀闸 + realpath 解析后仍在技能目录内（文件级符号
 * 链接指向目录外时拒读——与 listSkillFiles「符号链接不入清单」同律；技能
 * 根级链接目录的信任语义在 scanLocalSkills S11，边界 = 用户亲手放进技能根
 * 的目录，不外溢到目录内文件链接）。fileName 逃逸/绝对路径/不在盘/非常规
 * 文件 = null（路由面 404，不泄露存在性）；命中 = 解析后真实路径。 */
function resolveSkillFileReal(skillDir: string, fileName: string): string | null {
  let root: string;
  try {
    root = realpathSync(resolve(skillDir)); // 根先 realpath（macOS /var → /private/var 族）
  } catch {
    return null;
  }
  const target = resolve(root, fileName);
  if (target !== root && !target.startsWith(root + sep)) return null; // 文本逃逸
  if (target === root) return null; // fileName='' 解析回目录本身
  let real: string;
  let st: Stats;
  try {
    real = realpathSync(target); // 解析全部符号链接后仍在目录内才受理
    st = statSync(real);
  } catch {
    return null;
  }
  if (real !== root && !real.startsWith(root + sep)) return null; // 链接逃逸
  if (!st.isFile()) return null;
  return real;
}

/** 技能目录内单文件读（文本投影，web 读面）。守卫见 resolveSkillFileReal；
 * 超容量闸 = 400（点名上限）。 */
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

/** 技能目录内单文件原始字节读（machine-wire 分发面，#920）。守卫与
 * readSkillFile 同源（resolveSkillFileReal），但无容量闸、无 utf8 解码：
 * 分发是逐文件按需拉（清单带 sizeBytes/sha256，daemon 双校验），单请求
 * 预算与库总量解耦，整包闸失去存在理由；二进制资产逐字节诚实下发
 * （旧文本投影会把非 utf8 内容解码坏）。 */
export function readSkillFileBytes(skillDir: string, fileName: string): Buffer | null {
  const real = resolveSkillFileReal(skillDir, fileName);
  if (real === null) return null;
  return readFileSync(real);
}

/** agent.skills[] 授权勾选过滤（spec 13：校验源 = 现扫存在性；未知 id 静默
 * 跳过不报错——目录删除后死引用随下次写入自然脱落，任务面不炸）。 */
export function filterKnownSkillIds(skillsDir: string, ids: string[]): string[] {
  const known = new Set(scanLocalSkills(skillsDir).map((s) => s.id));
  return ids.filter((id) => known.has(id));
}

// —— 写路径（XMON-109 S1，spec 13 回摆）———————————————————————————————————

/** 写面执行者（审计行 actor；REST = member，worker relay = agent，
 * chief relay = 绑定 agent 或无绑定时的 member）。 */
export interface SkillAuditActor {
  type: 'member' | 'agent';
  id: string;
}

/** 单文件路径守卫：相对路径、posix 分隔、无空段/`.`/`..`/反斜杠/NUL、
 * 不以分隔符开头（绝对路径）。 */
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

/** 写面全量前置校验（先全量后落盘，无半写）：路径守卫 + 重复 path + 字节闸。
 * 返回本次写面总字节数（审计 bytes 位）。 */
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

/** frontmatter 与 body 声明对拍（唯一真值律）：SKILL.md frontmatter 的
 * name/description 必须在位且与 body 声明逐字一致——frontmatter 是技能
 * 身份与描述的存储位，body 声明只是显式冗余，两者漂移 = 400 点名两值。 */
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

/** 单文件落盘守卫 + 写：逐段 lstat walk——路径上任一既有符号链接 = 拒写
 * （拒绝穿越链接写出技能目录；与 readSkillFile「链接逃逸拒读」同律，方向
 * 相反）；中间段已是普通文件 = 400；落点已存在且非普通文件 = 400。守卫
 * 全过才 mkdir + 写（同一文件内无半写；多文件间由调用方先全量校验保证）。 */
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
      continue; // 缺失中间目录：下方 recursive mkdir 补齐
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

/** 审计行落库（三入口同表：REST / worker relay / chief relay）。 */
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

/** 建技能（XMON-109：POST /api/skills + relay create_skill 同源）。body.name
 * = 目录名（须过安全域正则），且须与 SKILL.md frontmatter name 一致——
 * 由此 create 产物的 id = name = 目录名三者同值；改名语义只在 update
 * （携带新 frontmatter）。目录名占用或撞既有 id（他目录 frontmatter 同名）
 * = 409 点名来源；全部校验先于任何落盘。 */
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

/** 撤回一次刚成功的 create（#1185）。导入在来源登记失败时调用：目录是
 * 这次 create 新建的，create 审计行取该 skillId 最新一条。 */
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

/** 更新技能（PUT /api/teams/{id}/skills/{sid} + relay update_skill 同源）：
 * 覆写语义——列出者覆写、未列者保留；目录固定（不随改名移动），id 随
 * SKILL.md frontmatter 走。携新 SKILL.md = 改 frontmatter（含改名，撞他
 * id 409）；不携 = body 声明须与现 frontmatter 一致（身份不容隐式改）。
 * 未知 id = 404（resolveLocalSkill 同读面）。 */
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
    // 改名撞既有 id（排除自身目录）= 409
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
