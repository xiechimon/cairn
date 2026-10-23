// 技能可见面单源（spec 14/#371）：本机 + 团队目录扫描 → `<available_skills>`
// catalog 注入（#1106/#1116 绑定序 + 字节预算）→ allowlist 硬挡（#917 deny
// 集 + 门控 read）→ team view 条目投影（#1171 native 插件面）+ 原生发现对照
// 探针（#919）。消费面三方共用同一扫描（catalog、deny、team 投影——参数形状
// 不得各自漂移）：pi 的简报通道（PiBackend.brief）、claude-code 后端的 deny
// 路径规则与 native 插件装配（claude-code.ts）、测试族（skills-*）。
// 缝纪律：本模块在 backend/ 缝内（biome noRestrictedImports 对
// apps/daemon/src/backend/** 放行 @earendil-works/*）；缝外模块经
// AgentBackend / SessionOpts 间接消费。

import { constants, readFileSync, realpathSync } from 'node:fs';
import { access as fsAccess, readFile as fsReadFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, sep } from 'node:path';
import type { SkillsInjectionNames } from '@cairn/shared';
import {
  DefaultResourceLoader,
  detectSupportedImageMimeTypeFromFile,
  formatSkillsForPrompt,
  loadSkills,
  type ReadOperations,
  type ResourceDiagnostic,
  SettingsManager,
  type Skill,
} from '@earendil-works/pi-coding-agent';

// —— skills 执行面注入（spec 14/#371）————————————————————————
// catalog 是索引不全文：token 预算只与 catalog 长度线性相关，skill 全文由
// agent 按 description 匹配时经 read 工具（location 绝对路径）按需加载。

/** catalog 字节预算（#1116，2026-10-10 用户裁决：口径 (b) 字节预算 + (c) 按
 * agent 绑定，替除旧「机器范围全集 + 50 条盲切」）。可见集由绑定面决定
 * （#372 allowlist ∩ #1106 注入选择；chief = 信任面全量），本预算只作 prompt
 * 膨胀的兜底闸：按 UTF-8 字节计（CJK 诚实，不用 .length 低估 3 倍），超限
 * 按优先序（绑定序 → 团队目录在前的扫描序）从尾部丢弃并显式点名（日志
 * `budget:` 行 + 目录尾 `<omitted_skills>` 段，agent 与用户都看得见丢了谁），
 * 不再静默盲切。1 MiB 对齐参照产品 Multica pack-archive 的
 * MAX_SKILL_FILE_BYTES（packages/core/skills/pack-archive.ts——catalog 本身
 * 是一份文本工件，取其单文件档；8 MiB/包与 256 文件/包档归物理分发面
 * （#920 清单 + 按需拉，有意不设整包闸），不由本闸承担）。 */
export const SKILLS_CATALOG_BUDGET_BYTES = 1 << 20;

/** 保证不存在的 pi 默认 agentDir（spec 14：强制 loadSkills 跳过 user 级默认
 * 扫描——includeDefaults:false 下 agentDir 仅参与 source 标注，传不存在路径
 * 杜绝任何静默默认加载）。 */
const NO_PI_DEFAULT_AGENT_DIR = join(homedir(), '.cairn-no-such', 'agent');

/** pi 诊断 → `[skills] <type>:` 词表归类（spec 14 日志族：collision /
 * invalid-frontmatter / missing-skill-md；其余 warning/error → invalid 透传）。
 * pi 诊断 message 为自由文本，归类按语义关键词 [推断]。 */
function classifySkillDiagnostic(d: ResourceDiagnostic): string {
  if (d.type === 'collision') return 'collision';
  if (/does not exist|ENOENT|no such file/i.test(d.message)) return 'missing-skill-md';
  if (/^(name|description)\b|frontmatter|parse/i.test(d.message)) return 'invalid-frontmatter';
  return 'invalid';
}

export interface SkillsCatalogOpts {
  /** 扫描根（CAIRN_SKILLS_DIR；目录缺失 = 空集非致命，pi 出诊断行）。 */
  skillsDir: string;
  /** loadSkills 的 cwd = daemon home（非任务 worktree——project 级解析不随
   * worktree 切换跳变，spec 14 Implementation Decisions）。 */
  cwd: string;
  /** per-agent 白名单（#372，SessionOpts.skillsAllowlist 透传）：slug 集
   * （frontmatter name 回落目录名，#367 wire 模型同源）。undefined = 全量
   * 直通（chief 面）；[] = 不注入任何 skill（与 MCP 空勾选同律）；名单内
   * 未知 slug（目录已删）静默跳过。过滤先于 cap 闸——白名单内条目不受
   * 目录总量截顶影响。 */
  allowlist?: string[];
  /** #1106 派发技能注入选择（SessionOpts.injectedSkills 透传；server 按任务
   * 文本对授予集规则选出的 ids）：在位（含 []）= 目录注入按本集收窄——
   * 空集 = 已计算零命中（零注入不是故障）；ids 与 allowlist 求交（选择不越
   * 授权，运行时防御）；选中条目 description 全文不截断（选择本身已控噪声，
   * 200 字预算闸让位）。缺省 = 旧 server 形，allowlist 全量直通（含截断，
   * 零回归）。**不影响 deny 面**（collectDeniedSkillDirs 仍只吃 allowlist
   * ——授权语义不随注入选择收窄，#917）。 */
  injectedSkills?: string[];
  /** 团队技能物化目录（XMON-112 S2，spec 14 增补）：排在本机 skillsDir 之前
   * 扫描——pi loadSkills first-wins（先进 Map 者为 winner），同名冲突团队条目
   * 胜、本机影子进 collision 诊断行（loser）。字节预算对合并后序列生效，团队
   * 条目居扫描序前端（优先序高档）。缺省 = 纯本机扫描（输出与旧行为逐字节
   * 等价）。 */
  teamSkillsDir?: string;
  /** #1299 任务 worktree 侧技能目录（如 `.claude/skills`、`.pi/skills`）：
   * 排在 skillsDir 之后扫描——first-wins 下同名冲突团队/本机条目胜（worktree
   * 条目是最低优先 loser）。目录缺失 loadSkills 出 warning 诊断（#1299 失败
   * 方式 2：静默收窄不报错）。pi 后端送 `.claude/skills` + `.pi/skills`（若
   * 在）；claude-code 不送（其原生技能发现面已覆盖）。缺省 = 不扩（零回归）。 */
  worktreeSkillsDirs?: string[];
  /** catalog 字节预算覆写（#1116 测试注入面 [设计]；缺省 =
   * SKILLS_CATALOG_BUDGET_BYTES）。 */
  budgetBytes?: number;
  /** `[skills] <type>: <msg>` 诊断行出口（machine-loop 接 logger.skills）。 */
  log?: (msg: string) => void;
  /** #1186 实际注入名集（scan + 预算之后；扫描失败交空集）。日志行不是
   * 可断言面，名字从这里出。缺省 = 不采集。 */
  onResolved?: (names: SkillsInjectionNames) => void;
}

/** 会话面扫描参数单源（catalog 注入与硬挡拒绝集共用——两个消费面对同一
 * 技能全集负责，参数形状不得各自漂移）：团队目录在前 = first-wins 冲突裁决
 * 的胜出序（XMON-112 S2）；agentDir 钉不存在路径杜绝 pi 默认扫描；#1299
 * worktree 侧目录（`.claude/skills`/`.pi/skills`）排尾——first-wins 下同名
 * 冲突团队/本机条目胜（worktree 条目是最低优先 loser）。缺省 teamSkillsDir
 * 且缺省 worktreeSkillsDirs 时 skillPaths 与旧行为完全一致（零回归判据的
 * 扫描面）。 */
function scanSessionSkills(
  skills: { skillsDir: string; cwd: string },
  teamSkillsDir: string | undefined,
  worktreeSkillsDirs?: string[],
): { skills: Skill[]; diagnostics: ResourceDiagnostic[] } {
  const skillPaths =
    teamSkillsDir !== undefined ? [teamSkillsDir, skills.skillsDir] : [skills.skillsDir];
  if (worktreeSkillsDirs !== undefined && worktreeSkillsDirs.length > 0) {
    skillPaths.push(...worktreeSkillsDirs);
  }
  return loadSkills({
    cwd: skills.cwd,
    agentDir: NO_PI_DEFAULT_AGENT_DIR,
    skillPaths,
    includeDefaults: false,
  });
}

/** 两条 collision 文件内容逐字节相同 = 纯镜像（单机 server skillsDir 与
 * daemon skillsDir 指同一棵库的常见形：物化视图与本机目录互为副本）。读失败
 * 按不同处理（回落逐条行，不吞诊断）。 */
function isIdenticalMirror(winnerPath: string, loserPath: string): boolean {
  try {
    return readFileSync(winnerPath).equals(readFileSync(loserPath));
  } catch {
    return false;
  }
}

/** 绑定序收编（#1116 优先序）：注入选择在位 = 选择序，其次白名单序（用户
 * 勾选/置顶的操作面——数组顺序即优先级），缺省 = 扫描序（团队目录在前）。
 * 名单内未知 slug 无对应 skill，天然静默跳过（#367 容忍语义）。 */
function orderSkillsByBinding(skills: Skill[], order: readonly string[] | undefined): Skill[] {
  if (order === undefined) return skills;
  const byName = new Map(skills.map((s) => [s.name, s]));
  return order.flatMap((id) => {
    const s = byName.get(id);
    return s === undefined ? [] : [s];
  });
}

/** 按字节预算装填：保留优先序前缀（二分找最大 k——目录字节数随条目数单调
 * 递增，log2(n) 次 render），尾部（最低优先）丢弃。预算装不下表头+首条 = 全
 * 丢（k=0 恒合法：空目录 render 为 0 字节）。 */
function fitSkillsToBudget(
  skills: Skill[],
  budgetBytes: number,
): { kept: Skill[]; dropped: Skill[]; totalBytes: number } {
  const bytes = (n: number): number =>
    Buffer.byteLength(formatSkillsForPrompt(skills.slice(0, n), 'read'), 'utf8');
  let lo = 0; // 恒合法（空 = 0 字节 ≤ 预算）
  let hi = skills.length; // 合法上界候选（超预算则收缩）
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2); // 取上中位：mid > lo 保证前进
    if (bytes(mid) <= budgetBytes) lo = mid;
    else hi = mid - 1;
  }
  const totalBytes = bytes(skills.length);
  return { kept: skills.slice(0, lo), dropped: skills.slice(lo), totalBytes };
}

/** 超预算丢名清单（日志 + 目录尾段共用）：名字集上限 100——极端库的丢名
 * 本身不该再把日志/note 撑爆；超出部分收进「+N more」。 */
function listDroppedNames(dropped: readonly Skill[]): string {
  const names = dropped.map((s) => s.name);
  return names.length <= 100
    ? names.join(', ')
    : `${names.slice(0, 100).join(', ')} +${names.length - 100} more`;
}

/** 扫描 skills 目录 → `<available_skills>` catalog XML 串（空串 = 无可注入
 * skills）。loadSkills 抛错（权限等）降级空集 + invalid 行，不阻断会话创建
 * （spec 14 Premortem 护栏）。预算语义见 SKILLS_CATALOG_BUDGET_BYTES。 */
export function buildSkillsCatalog(opts: SkillsCatalogOpts): string {
  const log = opts.log;
  let skills: Skill[];
  let diagnostics: ResourceDiagnostic[];
  try {
    const result = scanSessionSkills(opts, opts.teamSkillsDir, opts.worktreeSkillsDirs);
    skills = result.skills;
    diagnostics = result.diagnostics;
  } catch (err) {
    log?.(`invalid: ${err instanceof Error ? err.message : String(err)}`);
    log?.('catalog: entries=0 chars=0 bytes=0');
    opts.onResolved?.({ injected: [], omitted: [], unrendered: [] });
    return '';
  }
  // collision 降噪（#1116 ②）：identical mirror（团队物化视图 = 本机同库副本）
  // 归并为一行汇总——逐条行只留给内容真冲突（团队版覆盖本机版是真信号）。
  let identicalMirrors = 0;
  for (const d of diagnostics) {
    if (
      d.type === 'collision' &&
      d.collision !== undefined &&
      isIdenticalMirror(d.collision.winnerPath, d.collision.loserPath)
    ) {
      identicalMirrors++;
      continue;
    }
    const where =
      d.collision !== undefined
        ? ` (winner=${d.collision.winnerPath} loser=${d.collision.loserPath})`
        : d.path !== undefined
          ? ` (${d.path})`
          : '';
    log?.(`${classifySkillDiagnostic(d)}: ${d.message}${where}`);
  }
  if (identicalMirrors > 0) {
    log?.(
      `collision: ${identicalMirrors} identical mirror(s) deduped (team view wins; ` +
        `budget counts the merged set once)`,
    );
  }
  // per-agent 白名单过滤（#372）：先于预算闸——白名单是授权语义（谁能进
  // catalog），预算是成本语义（进者兜底截顶）；顺序颠倒会让目录总量把授权
  // 条目挤掉。
  if (opts.allowlist !== undefined) {
    const allowed = new Set(opts.allowlist);
    const kept: Skill[] = [];
    for (const s of skills) {
      if (allowed.has(s.name)) kept.push(s);
      else log?.(`filtered: ${s.name} not in agent allowlist`);
    }
    skills = kept;
  }
  // #1106 注入选择收窄：选择在位 = 目录按选择集再收窄（与 allowlist 过滤
  // 叠加即求交——选择不越授权）。
  const injected = opts.injectedSkills;
  if (injected !== undefined) {
    const selected = new Set(injected);
    const kept: Skill[] = [];
    for (const s of skills) {
      if (selected.has(s.name)) kept.push(s);
      else log?.(`filtered: ${s.name} not in injected selection`);
    }
    skills = kept;
  }
  // 优先序 = 绑定序（注入选择序 > 白名单序 > 扫描序）——超预算时尾部先丢，
  // 排序/置顶的操作面 = 调整绑定数组顺序（#1116 ①）。
  skills = orderSkillsByBinding(skills, injected ?? opts.allowlist);
  // 字节预算兜底（#1116）：替换旧 50 条盲切。disableModelInvocation 条目
  // formatSkillsForPrompt 本就不渲染——预筛出预算集，装填数学才诚实
  // （它们不占预算、不进丢名清单）。
  const budgetable = skills.filter((s) => !s.disableModelInvocation);
  const budget = opts.budgetBytes ?? SKILLS_CATALOG_BUDGET_BYTES;
  const { kept, dropped, totalBytes } = fitSkillsToBudget(budgetable, budget);
  let catalog = formatSkillsForPrompt(kept, 'read');
  if (dropped.length > 0) {
    const names = listDroppedNames(dropped);
    log?.(`budget: total=${totalBytes} budget=${budget} dropped=${dropped.length}: ${names}`);
    // 非静默信号（#1116 ①）：被丢技能在目录尾点名——agent 自己也看得见
    // 「哪些技能存在但没进清单」，用户侧出口 = 上方日志行。note 本身不吃
    // 预算（它是信号不是载荷，长度由丢名清单上限约束）。
    catalog +=
      `\n\n<omitted_skills reason="byte-budget" budget="${budget}">\n` +
      `The following skills exist but were omitted from the catalog to fit the byte budget: ${names}\n` +
      `</omitted_skills>`;
  }
  if (skills.length > 0) {
    log?.(
      opts.teamSkillsDir !== undefined
        ? `loaded: ${skills.length} skills from ${opts.teamSkillsDir} + ${opts.skillsDir}`
        : `loaded: ${skills.length} skills from ${opts.skillsDir}`,
    );
  }
  // 观测信号（#917 口径 5）：目录条数/字节数每次构造都落行——entries=0 也落，
  // 「注入了多少」不靠 loaded 行的在位与否反推。#1116 起补 bytes 位（预算
  // 口径 = UTF-8 字节，与 chars 分开报）。
  log?.(
    `catalog: entries=${kept.length} chars=${catalog.length} bytes=${Buffer.byteLength(catalog, 'utf8')}`,
  );
  opts.onResolved?.({
    injected: kept.map((s) => s.name),
    omitted: dropped.map((s) => s.name),
    unrendered: skills.filter((s) => s.disableModelInvocation).map((s) => s.name),
  });
  return catalog;
}

/** catalog 追加语义（spec 14 数据契约：追加到 systemPrompt 末尾而非覆盖；
 * formatSkillsForPrompt 产物自带 `\n\n` 前导分隔，base 在位时直接拼接；
 * base 缺省时剥前导空行独立成 prompt）。 */
export function appendSkillsCatalog(base: string | undefined, catalog: string): string | undefined {
  if (catalog === '') return base;
  if (base === undefined || base === '') return catalog.replace(/^\n+/, '');
  return base + catalog;
}

/** 后端简报通道共用的技能目录构造（#958）。pi 与 claude-code 的 skills 注入面
 * 同形（claude-code.ts 直接从本模块导入本函数族），抽出来是因为简报改由 runner
 * 组装——而目录构造吃的是**后端私有**的 skillsDir 与 cwd（spec 14 §49：cwd 用
 * daemon home 而非任务 worktree，避免 project 级解析随 worktree 切换跳变），
 * runner 侧面拿不到这份配置。 */
export function composeSkillsSection(
  skills: { skillsDir: string; cwd: string } | undefined,
  opts: {
    skillsAllowlist?: string[];
    injectedSkills?: string[];
    teamSkillsDir?: string;
    worktreeSkillsDirs?: string[];
    onSkillsResolved?: (names: SkillsInjectionNames) => void;
  },
  log?: (msg: string) => void,
): string {
  if (!skills) {
    opts.onSkillsResolved?.({ injected: [], omitted: [], unrendered: [] });
    return '';
  }
  return buildSkillsCatalog({
    skillsDir: skills.skillsDir,
    cwd: skills.cwd,
    ...(opts.skillsAllowlist !== undefined ? { allowlist: opts.skillsAllowlist } : {}),
    ...(opts.injectedSkills !== undefined ? { injectedSkills: opts.injectedSkills } : {}),
    ...(opts.teamSkillsDir !== undefined ? { teamSkillsDir: opts.teamSkillsDir } : {}),
    ...(opts.worktreeSkillsDirs !== undefined
      ? { worktreeSkillsDirs: opts.worktreeSkillsDirs }
      : {}),
    ...(opts.onSkillsResolved !== undefined ? { onResolved: opts.onSkillsResolved } : {}),
    ...(log ? { log } : {}),
  });
}

// —— 白名单硬挡（#917 口径 4，spec 14 §技能可见面收归）—————————————————
// 「不出现在目录里」只是提示级；未授权技能的文件读取必须被拒。未授权集单源
// = collectDeniedSkillDirs（与 buildSkillsCatalog 同参扫描、同 name 匹配语义）；
// 消费面两个：pi 的门控 read（本节）与 claude-code 的 deny 路径规则
// （claude-code.ts buildSkillDenyRules）。

/** 未授权技能条目：拒绝目标 = 技能目录（baseDir，含 SKILL.md 与全部引用
 * 文件）；name 供拒绝文案与日志点名。 */
export interface DeniedSkillEntry {
  name: string;
  baseDir: string;
}

/** 扫描 → allowlist 外技能的 baseDir 集。allowlist 缺省（chief 面）或 skills
 * 配置缺省 = 空集（全量直通零回归）；扫描失败 fail-open 空集——与 catalog
 * 同律：扫描失败时注入面也为空，无「目录里有、却挡不住」的错位。
 * #1299：worktreeSkillsDirs 加入拒绝扫描面——worktree 侧技能同样受 allowlist
 * 硬挡（catalog 与 deny 同扫描面的既有纪律）。 */
export function collectDeniedSkillDirs(
  skills: { skillsDir: string; cwd: string } | undefined,
  opts: { skillsAllowlist?: string[]; teamSkillsDir?: string; worktreeSkillsDirs?: string[] },
): DeniedSkillEntry[] {
  if (!skills || opts.skillsAllowlist === undefined) return [];
  let loaded: Skill[];
  try {
    loaded = scanSessionSkills(skills, opts.teamSkillsDir, opts.worktreeSkillsDirs).skills;
  } catch {
    return [];
  }
  const allowed = new Set(opts.skillsAllowlist);
  return loaded
    .filter((s) => !allowed.has(s.name))
    .map((s) => ({ name: s.name, baseDir: s.baseDir }));
}

/** 可见技能名集（#1299 /name 派发判定 + Skill 工具可见集校验）：与
 * buildSkillsCatalog 同一扫描 + 同一 allowlist/injectedSkills 过滤——可见
 * 判据两消费面永不漂移。扫描失败 = 空集（fail-open，/name 判定回落 no-op）。 */
export function collectVisibleSkillNames(opts: SkillsCatalogOpts): Set<string> {
  let skills: Skill[];
  try {
    skills = scanSessionSkills(opts, opts.teamSkillsDir, opts.worktreeSkillsDirs).skills;
  } catch {
    return new Set();
  }
  if (opts.allowlist !== undefined) {
    const allowed = new Set(opts.allowlist);
    skills = skills.filter((s) => allowed.has(s.name));
  }
  if (opts.injectedSkills !== undefined) {
    const selected = new Set(opts.injectedSkills);
    skills = skills.filter((s) => selected.has(s.name));
  }
  return new Set(skills.map((s) => s.name));
}

/** #1299 pi 后端 worktree 侧技能目录：任务 worktree 的 `.claude/skills` +
 * `.pi/skills`（目录不存在时 loadSkills 出 warning 诊断，不阻断——与 scan
 * 面其他目录同律，#1299 失败方式 2）。claude-code 后端不调——其原生技能
 * 发现面已覆盖 worktree 侧。 */
export function piWorktreeSkillDirs(cwd: string): string[] {
  return [join(cwd, '.claude', 'skills'), join(cwd, '.pi', 'skills')];
}

/** 可见技能名 → SKILL.md 绝对路径映射（#1299 Skill 工具预扫描 + 过滤）：
 * 与 buildSkillsCatalog 同一扫描 + 同一 allowlist/injectedSkills 过滤——工具
 * 面与 catalog 面同可见集，判据永不漂移。扫描失败 = 空 Map（fail-open）。 */
export function collectVisibleSkillFileMap(opts: SkillsCatalogOpts): Map<string, string> {
  let skills: Skill[];
  try {
    skills = scanSessionSkills(opts, opts.teamSkillsDir, opts.worktreeSkillsDirs).skills;
  } catch {
    return new Map();
  }
  if (opts.allowlist !== undefined) {
    const allowed = new Set(opts.allowlist);
    skills = skills.filter((s) => allowed.has(s.name));
  }
  if (opts.injectedSkills !== undefined) {
    const selected = new Set(opts.injectedSkills);
    skills = skills.filter((s) => selected.has(s.name));
  }
  return new Map(skills.map((s) => [s.name, s.filePath]));
}

/** 团队 view 内 allowed 条目（#1171 native 插件面消费形）：dirName = view
 * 子目录名（插件装配位）；name = frontmatter name 回落目录名（#367 wire
 * 同源——与 catalog/deny 同匹配语义）；baseDir 供测试/诊断指位。 */
export interface TeamSkillEntry {
  name: string;
  dirName: string;
  baseDir: string;
}

/** native 插件面 allowed 集单源（#1171）：与 catalog/deny 同一
 * scanSessionSkills 扫描（消费面对同一技能全集负责，参数形状不得各自漂移
 * ——本函数是该族的第三个消费面），取 baseDir 在 teamSkillsDir 之下的子集
 * （本机 skillsDir 条目不混入），按 skillsAllowlist 过滤（缺省 = 全量直通，
 * chief/null 面）。**不以 injectedSkills 收窄**——注入选择是 catalog 通道的
 * 噪声语义、不越授权面（#917「deny 面不随选择收窄」同律）。前缀比较两侧
 * 过 realpath 归一（createSkillReadGate 同律，macOS `/tmp` 漂移不得丢条目）。
 * 扫描失败 fail-open 空集（catalog 同律：注入面为空时无「目录里有、插件
 * 挡不住」的错位）。 */
export function collectTeamSkillEntries(
  skills: { skillsDir: string; cwd: string } | undefined,
  opts: { skillsAllowlist?: string[]; teamSkillsDir?: string },
): TeamSkillEntry[] {
  if (!skills || opts.teamSkillsDir === undefined) return [];
  let loaded: Skill[];
  try {
    loaded = scanSessionSkills(skills, opts.teamSkillsDir).skills;
  } catch {
    return [];
  }
  const resolve = (p: string): string => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };
  const viewReal = resolve(opts.teamSkillsDir);
  const allowed = opts.skillsAllowlist !== undefined ? new Set(opts.skillsAllowlist) : null;
  const out: TeamSkillEntry[] = [];
  for (const s of loaded) {
    if (allowed !== null && !allowed.has(s.name)) continue;
    const baseReal = resolve(s.baseDir);
    if (baseReal !== viewReal && !baseReal.startsWith(viewReal + sep)) continue;
    out.push({ name: s.name, dirName: basename(s.baseDir), baseDir: s.baseDir });
  }
  return out;
}

/** 门控 read 的判定 + operations 面。check：null = 放行；条目 = 拒绝（命中
 * 未授权技能目录，含目录自身）。路径两侧都过 realpath 归一——macOS
 * `/tmp` → `/private/tmp` 符号漂移不得放行；realpath 失败回落原形（目录
 * 缺失不影响前缀判定）。前缀比较带分隔符边界（`beta` 不吞 `beta-2`）。 */
export interface SkillReadGate {
  check(absolutePath: string): DeniedSkillEntry | null;
  operations: ReadOperations;
}

export function createSkillReadGate(
  denied: readonly DeniedSkillEntry[],
  log?: (msg: string) => void,
): SkillReadGate {
  const resolve = (p: string): string => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };
  const resolvedEntries = denied.map((entry) => ({ entry, resolved: resolve(entry.baseDir) }));
  const check = (absolutePath: string): DeniedSkillEntry | null => {
    const target = resolve(absolutePath);
    for (const { entry, resolved } of resolvedEntries) {
      if (target === resolved || target.startsWith(resolved + sep)) return entry;
    }
    return null;
  };
  const guard = async (absolutePath: string): Promise<void> => {
    const hit = check(absolutePath);
    if (hit === null) return;
    log?.(`denied-read: ${absolutePath} (skill ${hit.name} not in allowlist)`);
    // 拒绝进 tool error 结果（gated bash 同律：agent 可见改道文案，不抛断回合）。
    throw new Error(`read denied: skill '${hit.name}' is not in the agent allowlist`);
  };
  return {
    check,
    // pi read.js 的 operations 是整体替换（`options.operations ?? default`），
    // 三件必须齐——detectImageMimeType 透传 pi 原实现，图片读取面零扰动。
    operations: {
      readFile: async (absolutePath: string) => {
        await guard(absolutePath);
        return fsReadFile(absolutePath);
      },
      access: async (absolutePath: string) => {
        await guard(absolutePath);
        return fsAccess(absolutePath, constants.R_OK);
      },
      detectImageMimeType: detectSupportedImageMimeTypeFromFile,
    },
  };
}

/** #919 before 侧对照探针：pi 原生技能发现面（DefaultResourceLoader **不带**
 * noSkills——与 createAgentSession 的关断形只差这一个键）在同 agentDir/cwd
 * 下会发现哪些技能名。会话面恒 noSkills: true（spec 14 §技能可见面收归 3），
 * 本探针让「原生清单消失」的 after 断言在 CI 里永久保有可对照的 before 腿：
 * 探针返回空 = fixture 种植无效，after 侧「LLM 输入面不出现」即空转断言。
 * 只读，不建会话、不产副作用。 */
export async function discoverNativeSkills(opts: {
  agentDir: string;
  cwd: string;
}): Promise<string[]> {
  const loader = new DefaultResourceLoader({
    cwd: opts.cwd,
    agentDir: opts.agentDir,
    // 刻意不走 daemonSettingsManager（#925）：before 侧探针要复刻 pi 原生
    // 发现形（含 inMemory 的 projectTrusted 缺省 true），会话面的 deny 策略
    // 不属于「原生清单」这条对照腿。
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: true } }),
  });
  await loader.reload();
  return loader.getSkills().skills.map((s) => s.name);
}
