// skills 执行面注入（spec 14 / #371）：buildSkillsCatalog 输入五态 + 字节预算
// + appendSkillsCatalog 追加语义 + `[skills]` 日志行族。失败方式清单（票 #371
// 验收映射）：目录缺 / 目录空 / 目录无 SKILL.md / frontmatter 缺 name / name
// 碰撞 / systemPrompt 被覆盖而非追加 / `[skills]` 前缀行不落盘；#1116 起 cap
// 双闸（50 条盲切 + 200 字描述截断）换轨为字节预算 + 绑定优先序——失败方式
// 清单见「catalog 字节预算」与「团队镜像去重降噪」两 describe 头注。

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DAEMON_LOG_PREFIXES } from '@pacman/shared';
import { describe, expect, test } from 'vitest';
import {
  appendSkillsCatalog,
  buildSkillsCatalog,
  SKILLS_CATALOG_BUDGET_BYTES,
} from '../src/backend/skills.js';
import { createDaemonLogger, isLogPrefix } from '../src/log.js';

function fixtureRoot(tag: string): string {
  return mkdtempSync(join(tmpdir(), `pacman-skills-${tag}-`));
}

/** 写一个 skill 目录（<root>/<dirName>/SKILL.md）；返回 SKILL.md 绝对路径。 */
function writeSkill(
  root: string,
  dirName: string,
  opts: { name?: string; description?: string; body?: string } = {},
): string {
  const dir = join(root, dirName);
  mkdirSync(dir, { recursive: true });
  const fm: string[] = ['---'];
  if (opts.name !== undefined) fm.push(`name: ${opts.name}`);
  if (opts.description !== undefined) fm.push(`description: ${opts.description}`);
  fm.push('---', '');
  const file = join(dir, 'SKILL.md');
  writeFileSync(file, `${fm.join('\n')}\n${opts.body ?? `${dirName} body.`}\n`, 'utf8');
  return file;
}

function collect(
  skillsDir: string,
  allowlist?: string[],
  teamSkillsDir?: string,
  budgetBytes?: number,
): { catalog: string; logs: string[] } {
  const logs: string[] = [];
  const catalog = buildSkillsCatalog({
    skillsDir,
    cwd: tmpdir(),
    ...(allowlist !== undefined ? { allowlist } : {}),
    ...(teamSkillsDir !== undefined ? { teamSkillsDir } : {}),
    ...(budgetBytes !== undefined ? { budgetBytes } : {}),
    log: (msg) => logs.push(msg),
  });
  return { catalog, logs };
}

/** #1106 注入选择形 collect：injectedSkills 在位 = 目录注入按本集收窄。 */
function collectInjected(
  skillsDir: string,
  injectedSkills: string[],
  opts: { allowlist?: string[]; teamSkillsDir?: string } = {},
): { catalog: string; logs: string[] } {
  const logs: string[] = [];
  const catalog = buildSkillsCatalog({
    skillsDir,
    cwd: tmpdir(),
    injectedSkills,
    ...(opts.allowlist !== undefined ? { allowlist: opts.allowlist } : {}),
    ...(opts.teamSkillsDir !== undefined ? { teamSkillsDir: opts.teamSkillsDir } : {}),
    log: (msg) => logs.push(msg),
  });
  return { catalog, logs };
}

describe('buildSkillsCatalog 输入五态（spec 14 Testing Decisions）', () => {
  test('env 指向不存在目录 = 空 catalog 不炸 + missing-skill-md 诊断透传', () => {
    const { catalog, logs } = collect(join(fixtureRoot('gone'), 'no-such-dir'));
    expect(catalog).toBe('');
    expect(logs.some((l) => l.startsWith('missing-skill-md:'))).toBe(true);
    expect(logs.some((l) => l.startsWith('loaded:'))).toBe(false);
  });

  test('目录存在但空 = 空 catalog，无诊断（#917：catalog 观测行恒落）', () => {
    const { catalog, logs } = collect(fixtureRoot('empty'));
    expect(catalog).toBe('');
    expect(logs).toEqual(['catalog: entries=0 chars=0 bytes=0']);
  });

  test('目录含子目录但无 SKILL.md = 空 catalog（pi 递归扫描无命中）', () => {
    const root = fixtureRoot('nomd');
    mkdirSync(join(root, 'not-a-skill'), { recursive: true });
    writeFileSync(join(root, 'not-a-skill', 'notes.txt'), 'x', 'utf8');
    const { catalog } = collect(root);
    expect(catalog).toBe('');
  });

  test('正常 skill = catalog XML（name/description/location）+ read 工具指引 + loaded 行', () => {
    const root = fixtureRoot('normal');
    const file = writeSkill(root, 'demo-skill', {
      name: 'demo-skill',
      description: '演示技能：验证 catalog 注入。',
    });
    const { catalog, logs } = collect(root);
    expect(catalog).toContain('<available_skills>');
    expect(catalog).toContain('<name>demo-skill</name>');
    expect(catalog).toContain('<description>演示技能：验证 catalog 注入。</description>');
    expect(catalog).toContain(`<location>${file}</location>`);
    // fileReadTool='read'：catalog 指引用 read 工具按需加载（spec 14 注入形态）。
    expect(catalog).toContain('Use the read tool');
    expect(logs.some((l) => l.startsWith('loaded: 1 skills from '))).toBe(true);
  });

  test('frontmatter 缺 name = 回落目录名（与 #367 wire 形状同源）', () => {
    const root = fixtureRoot('fallback');
    writeSkill(root, 'fallback-dir', { description: '无 name 字段。' });
    const { catalog } = collect(root);
    expect(catalog).toContain('<name>fallback-dir</name>');
  });

  test('name 碰撞 = winner 单例入 catalog + collision 诊断透传', () => {
    const root = fixtureRoot('collision');
    writeSkill(root, 'a-dir', { name: 'dup-name', description: 'A 版。' });
    writeSkill(root, 'b-dir', { name: 'dup-name', description: 'B 版。' });
    const { catalog, logs } = collect(root);
    expect(catalog.split('<name>dup-name</name>').length - 1).toBe(1);
    const collision = logs.find((l) => l.startsWith('collision:'));
    expect(collision).toBeDefined();
    expect(collision).toContain('dup-name');
  });

  test('frontmatter 非法（name 含大写）= invalid-frontmatter 诊断透传', () => {
    const root = fixtureRoot('badfm');
    writeSkill(root, 'bad-name', { name: 'BadName', description: '名字含大写。' });
    const { logs } = collect(root);
    expect(logs.some((l) => l.startsWith('invalid-frontmatter:'))).toBe(true);
  });
});

// —— #1116 字节预算 + 绑定优先序（2026-10-10 用户裁决：口径 (b) 字节预算 +
// (c) 按 agent 绑定，不再用「机器范围全集 + 50 条盲切」）—————————————
// 失败方式清单（先于实现固化）：
// 1. 真库被静默砍半：99 技能 → 只有 50 进目录（旧 50 条闸）→ 预算内必须全量。
// 2. 超预算截顶静默：日志不点名丢谁、目录里无任何信号 → budget: 行点名 +
//    目录尾 <omitted_skills> 段（agent 自己也看得见）。
// 3. 盲切不看优先序：丢弃按扫描序盲切 → 绑定序（allowlist/injected 顺序）
//    = 优先序，从尾部（最低优先）丢。
// 4. 字节口径按 .length 计：CJK 描述 3× 低估 → 预算必须按 UTF-8 字节计。
// 5. description 被截半：路由凭据砍半掉触发率 → 不再截断（预算闸让位）。
// 6. 边界：预算连表头+首条都装不下 = 全丢，信号仍在（不静默）。

describe('catalog 字节预算（#1116：绑定集全量可见 + 超限非静默截顶）', () => {
  test(`99 技能库全量进目录（默认预算 ${SKILLS_CATALOG_BUDGET_BYTES}B 内零截顶）——票面验收场景`, () => {
    const root = fixtureRoot('budget-99');
    for (let i = 0; i < 99; i++) {
      writeSkill(root, `skill-${String(i).padStart(2, '0')}`, {
        name: `skill-${String(i).padStart(2, '0')}`,
        description: `演示技能 ${i}：路由用描述。`,
      });
    }
    const { catalog, logs } = collect(root);
    expect(catalog.split('<skill>').length - 1).toBe(99);
    expect(logs.some((l) => l.startsWith('budget:'))).toBe(false);
    expect(logs.some((l) => /^catalog: entries=99 chars=\d+ bytes=\d+$/.test(l))).toBe(true);
  });

  test('超预算 = 按优先序尾部丢弃 + budget 日志点名 + 目录尾 <omitted_skills> 段（非静默）', () => {
    const root = fixtureRoot('budget-over');
    for (let i = 0; i < 6; i++) {
      writeSkill(root, `skill-${i}`, {
        name: `skill-${i}`,
        description: `技能 ${i} 的路由描述，占一些字节。`,
      });
    }
    // 全量字节 - 1 = 必超预算至少 1 条；丢弃只发生在尾部。
    const full = collect(root);
    const fullBytes = Buffer.byteLength(full.catalog, 'utf8');
    const { catalog, logs } = collect(root, undefined, undefined, fullBytes - 1);
    const budgetLine = logs.find((l) => l.startsWith('budget:'));
    expect(budgetLine).toBeDefined();
    expect(budgetLine).toMatch(/^budget: total=\d+ budget=\d+ dropped=\d+: /);
    // 目录条数 < 6：确有丢弃发生。
    const kept = catalog.split('<skill>').length - 1;
    expect(kept).toBeLessThan(6);
    // 日志点名 = 被丢的每个名字；目录里它们缺席；被丢集合与 note 集合一致。
    const keptNames = [...catalog.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1]);
    const allNames = [...full.catalog.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1]);
    const droppedNames = allNames.filter((n) => !keptNames.includes(n));
    expect(droppedNames.length).toBeGreaterThan(0);
    for (const name of droppedNames) {
      expect(budgetLine).toContain(name);
      expect(catalog).not.toContain(`<name>${name}</name>`);
    }
    expect(catalog).toContain('</available_skills>');
    expect(catalog).toContain('<omitted_skills');
    expect(catalog).toMatch(/<\/omitted_skills>$/);
    for (const name of droppedNames) {
      expect(catalog).toContain(name); // note 段里点名（同一字符串出现即可）
    }
  });

  test('绑定序 = 优先序：allowlist 顺序决定目录序（不再按扫描序盲切）', () => {
    const root = fixtureRoot('budget-order');
    writeSkill(root, 'alpha', { name: 'alpha', description: 'A 技能。' });
    writeSkill(root, 'beta', { name: 'beta', description: 'B 技能。' });
    writeSkill(root, 'gamma', { name: 'gamma', description: 'C 技能。' });
    const { catalog } = collect(root, ['gamma', 'alpha', 'beta']);
    expect(catalog.indexOf('<name>gamma</name>')).toBeLessThan(
      catalog.indexOf('<name>alpha</name>'),
    );
    expect(catalog.indexOf('<name>alpha</name>')).toBeLessThan(
      catalog.indexOf('<name>beta</name>'),
    );
  });

  test('绑定序 = 存活序：超预算时绑定序末位先丢（置顶 = 调整绑定序）', () => {
    const root = fixtureRoot('budget-pin');
    writeSkill(root, 'z-first', { name: 'z-first', description: '绑定序首位。' });
    writeSkill(root, 'a-last', { name: 'a-last', description: '绑定序末位。' });
    const full = collect(root, ['z-first', 'a-last']);
    const fullBytes = Buffer.byteLength(full.catalog, 'utf8');
    const { catalog, logs } = collect(root, ['z-first', 'a-last'], undefined, fullBytes - 1);
    // 丢的是绑定序末位 a-last（扫描序里它字母在前——若仍按扫描序盲切，丢的
    // 会是 z-first）。这就是「能排序/置顶」的操作面。
    expect(catalog).toContain('<name>z-first</name>');
    expect(catalog).not.toContain('<name>a-last</name>');
    expect(logs.find((l) => l.startsWith('budget:'))).toContain('a-last');
  });

  test('注入选择序 = 优先序（#1106 选择集同律收编）', () => {
    const root = fixtureRoot('budget-inj-order');
    writeSkill(root, 'alpha', { name: 'alpha', description: 'A 技能。' });
    writeSkill(root, 'beta', { name: 'beta', description: 'B 技能。' });
    const { catalog } = collectInjected(root, ['beta', 'alpha']);
    expect(catalog.indexOf('<name>beta</name>')).toBeLessThan(
      catalog.indexOf('<name>alpha</name>'),
    );
  });

  test('字节口径 = UTF-8 字节（CJK 诚实）：按 .length 计会漏判的库必须触发预算', () => {
    const root = fixtureRoot('budget-cjk');
    // 300 个汉字 = 300 chars / 900 bytes。目录 bytes 落在 chars 与预算之上、
    // chars 落在预算之下——只有按字节计才会判超（自校准取中点，免受 tmpdir
    // 路径长度抖动影响）。
    writeSkill(root, 'cjk-skill', { name: 'cjk-skill', description: '汉'.repeat(300) });
    const full = collect(root);
    const chars = full.catalog.length;
    const bytes = Buffer.byteLength(full.catalog, 'utf8');
    const budget = Math.floor((chars + bytes) / 2);
    expect(bytes).toBeGreaterThan(budget); // 前提：byte 口径判超
    expect(chars).toBeLessThan(budget); // 前提：char 口径判不超
    const { catalog, logs } = collect(root, undefined, undefined, budget);
    expect(logs.some((l) => l.startsWith('budget:'))).toBe(true);
    expect(catalog).not.toContain('<name>cjk-skill</name>');
    expect(catalog).toContain('<omitted_skills');
  });

  test('description 不再截断：长路由描述全量进目录（#1116 裁决③随预算换轨退役）', () => {
    const root = fixtureRoot('budget-desc');
    const long = 'x'.repeat(500);
    writeSkill(root, 'long-desc', { name: 'long-desc', description: long });
    const { catalog, logs } = collect(root);
    expect(catalog).toContain(`<description>${long}</description>`);
    expect(logs.some((l) => l.startsWith('cap:'))).toBe(false);
  });

  test('预算装不下表头+首条 = 全丢，信号仍在（预算行 + note 段，不静默）', () => {
    const root = fixtureRoot('budget-floor');
    writeSkill(root, 'only-skill', { name: 'only-skill', description: '唯一技能。' });
    const { catalog, logs } = collect(root, undefined, undefined, 10);
    expect(catalog).not.toContain('<available_skills>');
    expect(catalog).toContain('<omitted_skills');
    expect(catalog).toContain('only-skill');
    expect(logs.some((l) => l.startsWith('budget:'))).toBe(true);
  });
});

describe('allowlist 过滤四态（#372：agent.skills 白名单 = catalog 执行面闸）', () => {
  /** 两个 skill 的公共 fixture；返回扫描根。 */
  function twoSkillRoot(tag: string): string {
    const root = fixtureRoot(tag);
    writeSkill(root, 'alpha', { name: 'alpha', description: 'A 技能。' });
    writeSkill(root, 'beta', { name: 'beta', description: 'B 技能。' });
    return root;
  }

  test('allowlist 缺省（undefined）= 全量直通（chief 面语义，零回归）', () => {
    const { catalog, logs } = collect(twoSkillRoot('al-full'));
    expect(catalog).toContain('<name>alpha</name>');
    expect(catalog).toContain('<name>beta</name>');
    expect(logs.some((l) => l.startsWith('filtered:'))).toBe(false);
  });

  test('部分过滤 = 白名单内保留、名单外剔除 + filtered 行', () => {
    const { catalog, logs } = collect(twoSkillRoot('al-part'), ['alpha']);
    expect(catalog).toContain('<name>alpha</name>');
    expect(catalog).not.toContain('<name>beta</name>');
    expect(logs).toContain('filtered: beta not in agent allowlist');
  });

  test('空白名单（[]）= 空 catalog，无 <available_skills> 块（least-privilege）', () => {
    const { catalog, logs } = collect(twoSkillRoot('al-empty'), []);
    expect(catalog).toBe('');
    expect(logs).toContain('filtered: alpha not in agent allowlist');
    expect(logs).toContain('filtered: beta not in agent allowlist');
    expect(logs.some((l) => l.startsWith('loaded:'))).toBe(false);
  });

  test('白名单含未知 slug = 静默跳过不炸（#367 容忍语义同律）', () => {
    const { catalog, logs } = collect(twoSkillRoot('al-ghost'), ['alpha', 'ghost-slug']);
    expect(catalog).toContain('<name>alpha</name>');
    expect(catalog).not.toContain('ghost-slug');
    // filtered 行只为「目录里有但被裁掉」的 skill 而记；ghost 不在目录，无行。
    expect(logs).toContain('filtered: beta not in agent allowlist');
    expect(logs.some((l) => l.includes('ghost-slug'))).toBe(false);
  });

  test('过滤先于预算闸 = 白名单内条目不受目录总量影响（#1116 起无条数闸）', () => {
    const root = fixtureRoot('al-cap');
    // 目录总量远超旧 50 条闸，但白名单只留 1 个排在扫描序后段的 skill：
    // 过滤先于预算（授权语义先于预算语义），它必然全量存活。
    const total = 55;
    for (let i = 0; i < total; i++) {
      writeSkill(root, `skill-${String(i).padStart(2, '0')}`, {
        name: `skill-${String(i).padStart(2, '0')}`,
        description: `批量技能 ${i}。`,
      });
    }
    const last = `skill-${String(total - 1).padStart(2, '0')}`;
    const { catalog, logs } = collect(root, [last]);
    expect(catalog).toContain(`<name>${last}</name>`);
    expect(logs.some((l) => l.startsWith('budget:'))).toBe(false);
  });
});

describe('appendSkillsCatalog（spec 14 数据契约：追加而非覆盖）', () => {
  test('catalog 空 = base 原样（含 undefined）——零回归面', () => {
    expect(appendSkillsCatalog('BASE', '')).toBe('BASE');
    expect(appendSkillsCatalog(undefined, '')).toBeUndefined();
  });

  test('base 在位 = catalog 追加到末尾（catalog 自带 \\n\\n 空行分隔）', () => {
    const out = appendSkillsCatalog('BASE', '\n\n<available_skills></available_skills>');
    expect(out).toBe('BASE\n\n<available_skills></available_skills>');
  });

  test('base 缺省 = catalog 独立成 prompt（首空行剥除）', () => {
    expect(appendSkillsCatalog(undefined, '\n\nCATALOG')).toBe('CATALOG');
    expect(appendSkillsCatalog('', '\n\nCATALOG')).toBe('CATALOG');
  });
});

describe('[skills] 日志行族（02 §5.3 前缀词表扩位）', () => {
  test('DAEMON_LOG_PREFIXES 含 skills；isLogPrefix 认可', () => {
    expect(DAEMON_LOG_PREFIXES).toContain('skills');
    expect(isLogPrefix('skills')).toBe(true);
  });

  test('createDaemonLogger.skills(msg) 落盘 `<ts> [skills] msg`（#691 落盘时间戳）', () => {
    const root = fixtureRoot('log');
    const logFile = join(root, 'daemon.log');
    const logger = createDaemonLogger({ logFile });
    logger.skills('loaded: 1 skills from /tmp/x');
    const lines = readFileSync(logFile, 'utf8').split('\n');
    // #691：落盘行带 wall-clock 前缀（无痕死亡事故的取证面）；stdout 面保持 canon 无时间戳。
    expect(
      lines.some((l) =>
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \[skills\] loaded: 1 skills from \/tmp\/x$/.test(l),
      ),
    ).toBe(true);
  });
});

// —— XMON-112 S2：团队技能物化目录合并（spec 14 增补）—————————————————
// 失败方式清单：团队/本机同名冲突（团队胜 + collision 行）/ 不相交合并 /
// cap 50 共享下团队优先 / allowlist=[] 纪律不变 / 零回归金样逐字节。

/** 零回归金样（票面验收 4）：期望字节 = 改动前 buildSkillsCatalog 对同一
 * fixture 的实际输出（2026-10-01 于 main b9455387 冻结），<ROOT> = 扫描根
 * 占位。任何触碰无团队目录路径的改动都会被它钉住。 */
const GOLDEN_CATALOG =
  "\n\nThe following skills provide specialized instructions for specific tasks.\nUse the read tool to load a skill's file when the task matches its description.\nWhen a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.\n\n<available_skills>\n  <skill>\n    <name>golden-skill</name>\n    <description>零回归金样。</description>\n    <location><ROOT>/golden-skill/SKILL.md</location>\n  </skill>\n</available_skills>";

function goldenRoot(tag: string): string {
  const root = fixtureRoot(tag);
  writeSkill(root, 'golden-skill', {
    name: 'golden-skill',
    description: '零回归金样。',
    body: 'golden body.',
  });
  return root;
}

describe('团队技能目录合并（XMON-112 S2）', () => {
  test('零回归金样：无 teamSkillsDir = 与改动前输出逐字节等价', () => {
    const root = goldenRoot('gold-a');
    const { catalog } = collect(root);
    expect(catalog.split(root).join('<ROOT>')).toBe(GOLDEN_CATALOG);
  });

  test('零回归金样：teamSkillsDir 显式 undefined = 同一字节', () => {
    const root = goldenRoot('gold-b');
    const { catalog } = collect(root, undefined, undefined);
    expect(catalog.split(root).join('<ROOT>')).toBe(GOLDEN_CATALOG);
  });

  test('同 id 冲突 = 团队条目胜（location/description 均为团队版）+ collision 行点名 winner=团队路径', () => {
    const local = fixtureRoot('tm-conflict-local');
    const team = fixtureRoot('tm-conflict-team');
    const localFile = writeSkill(local, 'dup', { name: 'dup', description: '本机版。' });
    const teamFile = writeSkill(team, 'dup', { name: 'dup', description: '团队版。' });
    const { catalog, logs } = collect(local, undefined, team);
    expect(catalog).toContain('<description>团队版。</description>');
    expect(catalog).not.toContain('<description>本机版。</description>');
    expect(catalog).toContain(`<location>${teamFile}</location>`);
    expect(catalog).not.toContain(`<location>${localFile}</location>`);
    const collision = logs.find((l) => l.startsWith('collision:'));
    expect(collision).toBeDefined();
    expect(collision).toContain(`winner=${teamFile}`);
    expect(collision).toContain(`loser=${localFile}`);
  });

  test('不相交合并 = 团队 + 本机都进 catalog（团队条目在前）+ 合并 loaded 行', () => {
    const local = fixtureRoot('tm-merge-local');
    const team = fixtureRoot('tm-merge-team');
    writeSkill(local, 'local-only', { name: 'local-only', description: '本机技能。' });
    writeSkill(team, 'team-only', { name: 'team-only', description: '团队技能。' });
    const { catalog, logs } = collect(local, undefined, team);
    expect(catalog).toContain('<name>team-only</name>');
    expect(catalog).toContain('<name>local-only</name>');
    expect(catalog.indexOf('<name>team-only</name>')).toBeLessThan(
      catalog.indexOf('<name>local-only</name>'),
    );
    expect(logs).toContain(`loaded: 2 skills from ${team} + ${local}`);
  });

  test('字节预算在合并目录共享生效：团队条目居扫描序前端（first-wins + 优先存活）', () => {
    const local = fixtureRoot('tm-cap-local');
    const team = fixtureRoot('tm-cap-team');
    writeSkill(local, 'local-tail', { name: 'local-tail', description: '本机末位技能。' });
    writeSkill(team, 'team-vip', { name: 'team-vip', description: '团队技能。' });
    const full = collect(local, undefined, team);
    const fullBytes = Buffer.byteLength(full.catalog, 'utf8');
    const { catalog, logs } = collect(local, undefined, team, fullBytes - 1);
    // 扫描序 = 团队目录在前 → 超预算从尾部丢，团队条目优先存活。
    expect(catalog).toContain('<name>team-vip</name>');
    const budgetLine = logs.find((l) => l.startsWith('budget:'));
    expect(budgetLine).toContain('local-tail');
  });

  test('allowlist=[] 纪律不变：团队目录在位也零注入（least-privilege）', () => {
    const local = fixtureRoot('tm-al-local');
    const team = fixtureRoot('tm-al-team');
    writeSkill(local, 'local-only', { name: 'local-only', description: '本机技能。' });
    writeSkill(team, 'team-only', { name: 'team-only', description: '团队技能。' });
    const { catalog } = collect(local, [], team);
    expect(catalog).toBe('');
  });

  test('allowlist 过滤对合并目录生效：名单外团队条目同样被裁', () => {
    const local = fixtureRoot('tm-al2-local');
    const team = fixtureRoot('tm-al2-team');
    writeSkill(team, 'team-a', { name: 'team-a', description: 'A。' });
    writeSkill(team, 'team-b', { name: 'team-b', description: 'B。' });
    const { catalog, logs } = collect(local, ['team-a'], team);
    expect(catalog).toContain('<name>team-a</name>');
    expect(catalog).not.toContain('<name>team-b</name>');
    expect(logs).toContain('filtered: team-b not in agent allowlist');
  });
});

// —— #1116 ②：团队镜像 ↔ 个人目录重叠的去重与降噪—————————————
// 失败方式清单（先于实现固化）：
// 1. 逐条 collision 刷屏：同库两份（server skillsDir = daemon skillsDir 的
//    单机常见形）每会话 99 行 collision 把真信号埋掉 → 内容逐字节相同的镜像
//    归并为一行汇总，不再逐条落。
// 2. 内容真冲突被降噪误伤：团队版≠本机版是真信号（覆盖语义）→ 逐条行保留。
// 3. 重叠双吃预算：镜像去重后按合并集算预算 → entries 与字节都只计一份。

describe('团队镜像去重降噪（#1116 ②：identical mirror 聚合 + 预算按去重集）', () => {
  /** 团队目录 + 本机目录各写一个同 name 技能；same=true 时内容逐字节相同。 */
  function mirrorPair(tag: string, same: boolean): { local: string; team: string } {
    const local = fixtureRoot(`${tag}-local`);
    const team = fixtureRoot(`${tag}-team`);
    writeSkill(local, 'dup-skill', {
      name: 'dup-skill',
      description: '同一技能。',
      body: same ? 'mirror body.' : 'local variant body.',
    });
    writeSkill(team, 'dup-skill', {
      name: 'dup-skill',
      description: '同一技能。',
      body: same ? 'mirror body.' : 'team variant body.',
    });
    return { local, team };
  }

  test('identical mirror = 一行汇总，无逐条 collision 行；目录条目只计一份', () => {
    const { local, team } = mirrorPair('mirror-same', true);
    const { catalog, logs } = collect(local, undefined, team);
    expect(catalog.split('<skill>').length - 1).toBe(1);
    const collisionLines = logs.filter((l) => l.startsWith('collision:'));
    // 一行汇总，无「name "dup-skill" collision (winner=…」逐条形。
    expect(collisionLines).toHaveLength(1);
    expect(collisionLines[0]).toContain('identical mirror');
    expect(collisionLines[0]).toContain('1');
    expect(collisionLines[0]).not.toContain('winner=');
  });

  test('多镜像 = 汇总行带计数（99 行 → 1 行的降噪面）', () => {
    const local = fixtureRoot('mirror-many-local');
    const team = fixtureRoot('mirror-many-team');
    for (let i = 0; i < 4; i++) {
      const name = `skill-${i}`;
      writeSkill(local, name, {
        name,
        description: `技能 ${i}。`,
        body: 'mirror body.',
      });
      writeSkill(team, name, {
        name,
        description: `技能 ${i}。`,
        body: 'mirror body.',
      });
    }
    const { catalog, logs } = collect(local, undefined, team);
    expect(catalog.split('<skill>').length - 1).toBe(4);
    const collisionLines = logs.filter((l) => l.startsWith('collision:'));
    expect(collisionLines).toHaveLength(1);
    expect(collisionLines[0]).toContain('4 identical mirror');
  });

  test('内容真冲突 = 逐条 collision 行保留（覆盖语义是真信号，不降噪）', () => {
    const { local, team } = mirrorPair('mirror-diff', false);
    const { catalog, logs } = collect(local, undefined, team);
    expect(catalog.split('<skill>').length - 1).toBe(1);
    const collisionLines = logs.filter((l) => l.startsWith('collision:'));
    expect(collisionLines).toHaveLength(1);
    expect(collisionLines[0]).toContain('winner=');
    expect(collisionLines[0]).toContain('loser=');
    expect(collisionLines[0]).not.toContain('identical mirror');
  });

  test('预算按去重后集合算：镜像重叠不双吃预算', () => {
    const { local, team } = mirrorPair('mirror-budget', true);
    // 预算 = 单条目录的精确字节数：若镜像被双计（旧口径按 50 条数切的对照面），
    // 这里会触发 budget 丢弃；去重后单条恰好在预算内。
    const full = collect(local, undefined, team);
    const singleBytes = Buffer.byteLength(full.catalog, 'utf8');
    const { catalog, logs } = collect(local, undefined, team, singleBytes);
    expect(catalog).toContain('<name>dup-skill</name>');
    expect(logs.some((l) => l.startsWith('budget:'))).toBe(false);
  });
});

// —— #1106 派发技能注入选择：目录注入收窄（失败方式先固化）—————————————
// injectedSkills（claim 载荷 agent.injectedSkills，server 按任务文本选出）在位
// = 目录按本集收窄且 description 全文不截断；缺省 = 旧 server 形回落
// allowlist（#1116 起同样全量——200 字截断随字节预算退役）。deny 面
// （collectDeniedSkillDirs）不因选择收窄——授权语义仍吃 allowlist 全量
// （本文件同款断言见 skills-hard-block.test.ts）。

describe('注入选择收窄（#1106：injectedSkills = 目录注入执行面）', () => {
  /** 三技能公共 fixture（alpha/beta/gamma）。 */
  function threeSkillRoot(tag: string): string {
    const root = fixtureRoot(tag);
    writeSkill(root, 'alpha', { name: 'alpha', description: 'A 技能。' });
    writeSkill(root, 'beta', { name: 'beta', description: 'B 技能。' });
    writeSkill(root, 'gamma', { name: 'gamma', description: 'C 技能。' });
    return root;
  }

  test('选择集只含部分 → 目录只出选中条目（允许集全量不影响注入面）', () => {
    const root = threeSkillRoot('inj-part');
    const { catalog, logs } = collectInjected(root, ['beta'], {
      allowlist: ['alpha', 'beta', 'gamma'],
    });
    expect(catalog).toContain('<name>beta</name>');
    expect(catalog).not.toContain('<name>alpha</name>');
    expect(catalog).not.toContain('<name>gamma</name>');
    expect(logs).toContain('filtered: alpha not in injected selection');
    expect(logs).toContain('filtered: gamma not in injected selection');
  });

  test('空选择集 = 已计算零命中 → 空 catalog（零注入不是故障，不保底全量）', () => {
    const root = threeSkillRoot('inj-empty');
    const { catalog, logs } = collectInjected(root, [], { allowlist: ['alpha'] });
    expect(catalog).toBe('');
    expect(logs).toContain('catalog: entries=0 chars=0 bytes=0');
  });

  test('选择集 ids ⊆ allowlist 的运行时防御：名单外 id 也不入目录（不越授权）', () => {
    const root = threeSkillRoot('inj-beyond');
    // server 保证 ⊆；本断言钉运行时防御——选择字段携带了越权 id 也不生效。
    const { catalog } = collectInjected(root, ['alpha', 'gamma'], { allowlist: ['alpha'] });
    expect(catalog).toContain('<name>alpha</name>');
    expect(catalog).not.toContain('<name>gamma</name>');
  });

  test('选中条目 description 超长 = 全文不截断（#1116 起全路径不截断，选择面同律）', () => {
    const root = fixtureRoot('inj-full-desc');
    const long = 'x'.repeat(500);
    writeSkill(root, 'long-desc', { name: 'long-desc', description: long });
    const { catalog, logs } = collectInjected(root, ['long-desc'], { allowlist: ['long-desc'] });
    expect(catalog).toContain(`<description>${long}</description>`);
    expect(logs.some((l) => l.startsWith('cap:'))).toBe(false);
    // 对照：缺省（旧 server 形）同样全量——200 字截断随 #1116 字节预算退役。
    const legacy = collect(root, ['long-desc']);
    expect(legacy.catalog).toContain(`<description>${long}</description>`);
  });

  test('选择集含未知 id（目录已删/未物化）= 静默跳过不炸（#367 容忍语义）', () => {
    const root = threeSkillRoot('inj-ghost');
    const { catalog, logs } = collectInjected(root, ['beta', 'ghost-slug'], {
      allowlist: ['alpha', 'beta', 'ghost-slug'],
    });
    expect(catalog).toContain('<name>beta</name>');
    expect(catalog).not.toContain('ghost-slug');
    expect(logs.some((l) => l.includes('ghost-slug'))).toBe(false);
  });

  test('injectedSkills 缺省 = 旧 server 形：allowlist 全量 + 200 字闸（零回归金样）', () => {
    const root = threeSkillRoot('inj-absent');
    const { catalog, logs } = collect(root, ['alpha', 'beta']);
    expect(catalog).toContain('<name>alpha</name>');
    expect(catalog).toContain('<name>beta</name>');
    expect(catalog).not.toContain('<name>gamma</name>');
    expect(logs).toContain('filtered: gamma not in agent allowlist');
  });

  test('注入选择与团队目录合并面共存：选择只收窄注入，合并/first-wins 不变', () => {
    const local = fixtureRoot('inj-tm-local');
    const team = fixtureRoot('inj-tm-team');
    writeSkill(team, 'team-vip', { name: 'team-vip', description: '团队技能。' });
    writeSkill(local, 'local-only', { name: 'local-only', description: '本机技能。' });
    const { catalog } = collectInjected(local, ['team-vip'], {
      allowlist: ['team-vip', 'local-only'],
      teamSkillsDir: team,
    });
    expect(catalog).toContain('<name>team-vip</name>');
    expect(catalog).not.toContain('<name>local-only</name>');
  });
});
