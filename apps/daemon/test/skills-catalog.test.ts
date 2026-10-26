import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DAEMON_LOG_PREFIXES } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  appendSkillsCatalog,
  buildSkillsCatalog,
  SKILLS_CATALOG_BUDGET_BYTES,
} from '../src/backend/skills.js';
import { createDaemonLogger, isLogPrefix } from '../src/log.js';

function fixtureRoot(tag: string): string {
  return makeTestTempDir(`cairn-skills-${tag}-`);
}

function writeSkill(
  root: string,
  dirName: string,
  opts: {
    name?: string;
    description?: string;
    body?: string;
    disableModelInvocation?: boolean;
  } = {},
): string {
  const dir = join(root, dirName);
  mkdirSync(dir, { recursive: true });
  const fm: string[] = ['---'];
  if (opts.name !== undefined) fm.push(`name: ${opts.name}`);
  if (opts.description !== undefined) fm.push(`description: ${opts.description}`);
  if (opts.disableModelInvocation) fm.push('disable-model-invocation: true');
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

describe('buildSkillsCatalog five input states (spec 14 Testing Decisions)', () => {
  test('env pointing at a missing directory = empty catalog without crashing + missing-skill-md diagnostic passes through', () => {
    const { catalog, logs } = collect(join(fixtureRoot('gone'), 'no-such-dir'));
    expect(catalog).toBe('');
    expect(logs.some((l) => l.startsWith('missing-skill-md:'))).toBe(true);
    expect(logs.some((l) => l.startsWith('loaded:'))).toBe(false);
  });

  test('directory exists but empty = empty catalog, no diagnostic (#917: catalog observation line always lands)', () => {
    const { catalog, logs } = collect(fixtureRoot('empty'));
    expect(catalog).toBe('');
    expect(logs).toEqual(['catalog: entries=0 chars=0 bytes=0']);
  });

  test('directory has subdirectories but no SKILL.md = empty catalog (pi recursive scan finds nothing)', () => {
    const root = fixtureRoot('nomd');
    mkdirSync(join(root, 'not-a-skill'), { recursive: true });
    writeFileSync(join(root, 'not-a-skill', 'notes.txt'), 'x', 'utf8');
    const { catalog } = collect(root);
    expect(catalog).toBe('');
  });

  test('normal skill = catalog XML (name/description/location) + read tool guidance + loaded line', () => {
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
    expect(catalog).toContain('Use the read tool');
    expect(logs.some((l) => l.startsWith('loaded: 1 skills from '))).toBe(true);
  });

  test('frontmatter missing name = falls back to the directory name (same source as the #367 wire shape)', () => {
    const root = fixtureRoot('fallback');
    writeSkill(root, 'fallback-dir', { description: '无 name 字段。' });
    const { catalog } = collect(root);
    expect(catalog).toContain('<name>fallback-dir</name>');
  });

  test('name collision = single winner enters the catalog + collision diagnostic passes through', () => {
    const root = fixtureRoot('collision');
    writeSkill(root, 'a-dir', { name: 'dup-name', description: 'A 版。' });
    writeSkill(root, 'b-dir', { name: 'dup-name', description: 'B 版。' });
    const { catalog, logs } = collect(root);
    expect(catalog.split('<name>dup-name</name>').length - 1).toBe(1);
    const collision = logs.find((l) => l.startsWith('collision:'));
    expect(collision).toBeDefined();
    expect(collision).toContain('dup-name');
  });

  test('invalid frontmatter (name contains uppercase) = invalid-frontmatter diagnostic passes through', () => {
    const root = fixtureRoot('badfm');
    writeSkill(root, 'bad-name', { name: 'BadName', description: '名字含大写。' });
    const { logs } = collect(root);
    expect(logs.some((l) => l.startsWith('invalid-frontmatter:'))).toBe(true);
  });
});

describe('catalog byte budget (#1116: binding set fully visible + non-silent truncation at the cap)', () => {
  test(`99-skill catalog fully listed (default budget ${SKILLS_CATALOG_BUDGET_BYTES}B, zero truncation) — acceptance scenario`, () => {
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

  test('over budget = tail-dropped by priority order + budget log naming + <omitted_skills> section at the catalog tail (not silent)', () => {
    const root = fixtureRoot('budget-over');
    for (let i = 0; i < 6; i++) {
      writeSkill(root, `skill-${i}`, {
        name: `skill-${i}`,
        description: `技能 ${i} 的路由描述，占一些字节。`,
      });
    }
    const full = collect(root);
    const fullBytes = Buffer.byteLength(full.catalog, 'utf8');
    const { catalog, logs } = collect(root, undefined, undefined, fullBytes - 1);
    const budgetLine = logs.find((l) => l.startsWith('budget:'));
    expect(budgetLine).toBeDefined();
    expect(budgetLine).toMatch(/^budget: total=\d+ budget=\d+ dropped=\d+: /);
    const kept = catalog.split('<skill>').length - 1;
    expect(kept).toBeLessThan(6);
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
      expect(catalog).toContain(name);
    }
  });

  test('binding order = priority order: allowlist order decides catalog order (no more blind cuts by scan order)', () => {
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

  test('binding order = survival order: on overflow the binding-order tail is dropped first (pinning = adjusting the binding order)', () => {
    const root = fixtureRoot('budget-pin');
    writeSkill(root, 'z-first', { name: 'z-first', description: '绑定序首位。' });
    writeSkill(root, 'a-last', { name: 'a-last', description: '绑定序末位。' });
    const full = collect(root, ['z-first', 'a-last']);
    const fullBytes = Buffer.byteLength(full.catalog, 'utf8');
    const { catalog, logs } = collect(root, ['z-first', 'a-last'], undefined, fullBytes - 1);
    expect(catalog).toContain('<name>z-first</name>');
    expect(catalog).not.toContain('<name>a-last</name>');
    expect(logs.find((l) => l.startsWith('budget:'))).toContain('a-last');
  });

  test('injection selection order = priority order (#1106 selection set absorbed by the same rule)', () => {
    const root = fixtureRoot('budget-inj-order');
    writeSkill(root, 'alpha', { name: 'alpha', description: 'A 技能。' });
    writeSkill(root, 'beta', { name: 'beta', description: 'B 技能。' });
    const { catalog } = collectInjected(root, ['beta', 'alpha']);
    expect(catalog.indexOf('<name>beta</name>')).toBeLessThan(
      catalog.indexOf('<name>alpha</name>'),
    );
  });

  test('byte measure = UTF-8 bytes (honest for CJK): a library that undercounts by .length must trigger the budget', () => {
    const root = fixtureRoot('budget-cjk');
    writeSkill(root, 'cjk-skill', { name: 'cjk-skill', description: '汉'.repeat(300) });
    const full = collect(root);
    const chars = full.catalog.length;
    const bytes = Buffer.byteLength(full.catalog, 'utf8');
    const budget = Math.floor((chars + bytes) / 2);
    expect(bytes).toBeGreaterThan(budget);
    expect(chars).toBeLessThan(budget);
    const { catalog, logs } = collect(root, undefined, undefined, budget);
    expect(logs.some((l) => l.startsWith('budget:'))).toBe(true);
    expect(catalog).not.toContain('<name>cjk-skill</name>');
    expect(catalog).toContain('<omitted_skills');
  });

  test('description no longer truncated: long routing descriptions enter the catalog in full (#1116 ruling ③ retired with the budget track change)', () => {
    const root = fixtureRoot('budget-desc');
    const long = 'x'.repeat(500);
    writeSkill(root, 'long-desc', { name: 'long-desc', description: long });
    const { catalog, logs } = collect(root);
    expect(catalog).toContain(`<description>${long}</description>`);
    expect(logs.some((l) => l.startsWith('cap:'))).toBe(false);
  });

  test('budget cannot fit header + first entry = all lost, signal remains (budget line + note section, not silent)', () => {
    const root = fixtureRoot('budget-floor');
    writeSkill(root, 'only-skill', { name: 'only-skill', description: '唯一技能。' });
    const { catalog, logs } = collect(root, undefined, undefined, 10);
    expect(catalog).not.toContain('<available_skills>');
    expect(catalog).toContain('<omitted_skills');
    expect(catalog).toContain('only-skill');
    expect(logs.some((l) => l.startsWith('budget:'))).toBe(true);
  });
});

describe('allowlist filtering four states (#372: agent.skills allowlist = catalog execution-surface gate)', () => {
  function twoSkillRoot(tag: string): string {
    const root = fixtureRoot(tag);
    writeSkill(root, 'alpha', { name: 'alpha', description: 'A 技能。' });
    writeSkill(root, 'beta', { name: 'beta', description: 'B 技能。' });
    return root;
  }

  test('allowlist absent (undefined) = full passthrough (chief-surface semantics, zero regression)', () => {
    const { catalog, logs } = collect(twoSkillRoot('al-full'));
    expect(catalog).toContain('<name>alpha</name>');
    expect(catalog).toContain('<name>beta</name>');
    expect(logs.some((l) => l.startsWith('filtered:'))).toBe(false);
  });

  test('partial filtering = kept inside the allowlist, dropped outside + filtered line', () => {
    const { catalog, logs } = collect(twoSkillRoot('al-part'), ['alpha']);
    expect(catalog).toContain('<name>alpha</name>');
    expect(catalog).not.toContain('<name>beta</name>');
    expect(logs).toContain('filtered: beta not in agent allowlist');
  });

  test('empty allowlist ([]) = empty catalog, no <available_skills> block (least privilege)', () => {
    const { catalog, logs } = collect(twoSkillRoot('al-empty'), []);
    expect(catalog).toBe('');
    expect(logs).toContain('filtered: alpha not in agent allowlist');
    expect(logs).toContain('filtered: beta not in agent allowlist');
    expect(logs.some((l) => l.startsWith('loaded:'))).toBe(false);
  });

  test('allowlist containing an unknown slug = silently skipped without crashing (#367 tolerance semantics, same rule)', () => {
    const { catalog, logs } = collect(twoSkillRoot('al-ghost'), ['alpha', 'ghost-slug']);
    expect(catalog).toContain('<name>alpha</name>');
    expect(catalog).not.toContain('ghost-slug');
    expect(logs).toContain('filtered: beta not in agent allowlist');
    expect(logs.some((l) => l.includes('ghost-slug'))).toBe(false);
  });

  test('filtering precedes the budget gate = entries inside the allowlist are unaffected by total catalog size (no count gate since #1116)', () => {
    const root = fixtureRoot('al-cap');
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

describe('appendSkillsCatalog (spec 14 data contract: append, not overwrite)', () => {
  test('empty catalog = base as-is (including undefined) — zero-regression surface', () => {
    expect(appendSkillsCatalog('BASE', '')).toBe('BASE');
    expect(appendSkillsCatalog(undefined, '')).toBeUndefined();
  });

  test('base present = catalog appended at the end (catalog carries its own \n\n blank-line separator)', () => {
    const out = appendSkillsCatalog('BASE', '\n\n<available_skills></available_skills>');
    expect(out).toBe('BASE\n\n<available_skills></available_skills>');
  });

  test('base absent = catalog stands alone as the prompt (leading blank line stripped)', () => {
    expect(appendSkillsCatalog(undefined, '\n\nCATALOG')).toBe('CATALOG');
    expect(appendSkillsCatalog('', '\n\nCATALOG')).toBe('CATALOG');
  });
});

describe('[skills] log line family (02 §5.3 prefix vocabulary expansion)', () => {
  test('DAEMON_LOG_PREFIXES contains skills; isLogPrefix accepts it', () => {
    expect(DAEMON_LOG_PREFIXES).toContain('skills');
    expect(isLogPrefix('skills')).toBe(true);
  });

  test('createDaemonLogger.skills(msg) writes `<ts> [skills] msg` to disk (#691 disk timestamp)', () => {
    const root = fixtureRoot('log');
    const logFile = join(root, 'daemon.log');
    const logger = createDaemonLogger({ logFile });
    logger.skills('loaded: 1 skills from /tmp/x');
    const lines = readFileSync(logFile, 'utf8').split('\n');
    expect(
      lines.some((l) =>
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \[skills\] loaded: 1 skills from \/tmp\/x$/.test(l),
      ),
    ).toBe(true);
  });
});

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

describe('team skills directory merge (XMON-112 S2)', () => {
  test('zero-regression golden sample: no teamSkillsDir = output byte-equivalent to before the change', () => {
    const root = goldenRoot('gold-a');
    const { catalog } = collect(root);
    expect(catalog.split(root).join('<ROOT>')).toBe(GOLDEN_CATALOG);
  });

  test('zero-regression golden sample: teamSkillsDir explicitly undefined = same bytes', () => {
    const root = goldenRoot('gold-b');
    const { catalog } = collect(root, undefined, undefined);
    expect(catalog.split(root).join('<ROOT>')).toBe(GOLDEN_CATALOG);
  });

  test('same-id conflict = team entry wins (location/description both the team version) + collision line names winner=team path', () => {
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

  test('disjoint merge = both team and local entries enter the catalog (team entries first) + merged loaded line', () => {
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

  test('byte budget applies across the merged catalog: team entries sit at the front of scan order (first-wins + priority survival)', () => {
    const local = fixtureRoot('tm-cap-local');
    const team = fixtureRoot('tm-cap-team');
    writeSkill(local, 'local-tail', { name: 'local-tail', description: '本机末位技能。' });
    writeSkill(team, 'team-vip', { name: 'team-vip', description: '团队技能。' });
    const full = collect(local, undefined, team);
    const fullBytes = Buffer.byteLength(full.catalog, 'utf8');
    const { catalog, logs } = collect(local, undefined, team, fullBytes - 1);
    expect(catalog).toContain('<name>team-vip</name>');
    const budgetLine = logs.find((l) => l.startsWith('budget:'));
    expect(budgetLine).toContain('local-tail');
  });

  test('allowlist=[] discipline unchanged: zero injection even with the team directory present (least privilege)', () => {
    const local = fixtureRoot('tm-al-local');
    const team = fixtureRoot('tm-al-team');
    writeSkill(local, 'local-only', { name: 'local-only', description: '本机技能。' });
    writeSkill(team, 'team-only', { name: 'team-only', description: '团队技能。' });
    const { catalog } = collect(local, [], team);
    expect(catalog).toBe('');
  });

  test('allowlist filtering applies to the merged catalog: team entries outside the list are cut too', () => {
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

describe('team mirror dedup and noise reduction (#1116 ②: identical mirror aggregation + budget over the deduped set)', () => {
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

  test('identical mirror = one summary line, no per-entry collision lines; catalog entry counted once', () => {
    const { local, team } = mirrorPair('mirror-same', true);
    const { catalog, logs } = collect(local, undefined, team);
    expect(catalog.split('<skill>').length - 1).toBe(1);
    const collisionLines = logs.filter((l) => l.startsWith('collision:'));
    expect(collisionLines).toHaveLength(1);
    expect(collisionLines[0]).toContain('identical mirror');
    expect(collisionLines[0]).toContain('1');
    expect(collisionLines[0]).not.toContain('winner=');
  });

  test('multiple mirrors = summary line carries a count (99 lines → 1 line of noise reduction)', () => {
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

  test('real content conflict = per-entry collision lines kept (override semantics are a real signal, not noise)', () => {
    const { local, team } = mirrorPair('mirror-diff', false);
    const { catalog, logs } = collect(local, undefined, team);
    expect(catalog.split('<skill>').length - 1).toBe(1);
    const collisionLines = logs.filter((l) => l.startsWith('collision:'));
    expect(collisionLines).toHaveLength(1);
    expect(collisionLines[0]).toContain('winner=');
    expect(collisionLines[0]).toContain('loser=');
    expect(collisionLines[0]).not.toContain('identical mirror');
  });

  test('budget computed over the deduped set: mirror overlap does not double-spend the budget', () => {
    const { local, team } = mirrorPair('mirror-budget', true);
    const full = collect(local, undefined, team);
    const singleBytes = Buffer.byteLength(full.catalog, 'utf8');
    const { catalog, logs } = collect(local, undefined, team, singleBytes);
    expect(catalog).toContain('<name>dup-skill</name>');
    expect(logs.some((l) => l.startsWith('budget:'))).toBe(false);
  });
});

describe('injection selection narrowing (#1106: injectedSkills = the catalog injection execution surface)', () => {
  function threeSkillRoot(tag: string): string {
    const root = fixtureRoot(tag);
    writeSkill(root, 'alpha', { name: 'alpha', description: 'A 技能。' });
    writeSkill(root, 'beta', { name: 'beta', description: 'B 技能。' });
    writeSkill(root, 'gamma', { name: 'gamma', description: 'C 技能。' });
    return root;
  }

  test('selection set covers only part → the catalog emits only the selected entries (the full allowed set does not affect the injection surface)', () => {
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

  test('empty selection set = computed zero hits → empty catalog (zero injection is not a failure, no full-set fallback)', () => {
    const root = threeSkillRoot('inj-empty');
    const { catalog, logs } = collectInjected(root, [], { allowlist: ['alpha'] });
    expect(catalog).toBe('');
    expect(logs).toContain('catalog: entries=0 chars=0 bytes=0');
  });

  test('runtime defense for selection-set ids ⊆ allowlist: ids outside the list do not enter the catalog either (no over-authorization)', () => {
    const root = threeSkillRoot('inj-beyond');
    const { catalog } = collectInjected(root, ['alpha', 'gamma'], { allowlist: ['alpha'] });
    expect(catalog).toContain('<name>alpha</name>');
    expect(catalog).not.toContain('<name>gamma</name>');
  });

  test('selected entry with an overlong description = full text not truncated (no truncation anywhere since #1116, same rule on the selection surface)', () => {
    const root = fixtureRoot('inj-full-desc');
    const long = 'x'.repeat(500);
    writeSkill(root, 'long-desc', { name: 'long-desc', description: long });
    const { catalog, logs } = collectInjected(root, ['long-desc'], { allowlist: ['long-desc'] });
    expect(catalog).toContain(`<description>${long}</description>`);
    expect(logs.some((l) => l.startsWith('cap:'))).toBe(false);
    const legacy = collect(root, ['long-desc']);
    expect(legacy.catalog).toContain(`<description>${long}</description>`);
  });

  test('selection set containing an unknown id (deleted from catalog / not materialized) = silently skipped without crashing (#367 tolerance semantics)', () => {
    const root = threeSkillRoot('inj-ghost');
    const { catalog, logs } = collectInjected(root, ['beta', 'ghost-slug'], {
      allowlist: ['alpha', 'beta', 'ghost-slug'],
    });
    expect(catalog).toContain('<name>beta</name>');
    expect(catalog).not.toContain('ghost-slug');
    expect(logs.some((l) => l.includes('ghost-slug'))).toBe(false);
  });

  test('injectedSkills absent = old-server shape: full allowlist + 200-char gate (zero-regression golden sample)', () => {
    const root = threeSkillRoot('inj-absent');
    const { catalog, logs } = collect(root, ['alpha', 'beta']);
    expect(catalog).toContain('<name>alpha</name>');
    expect(catalog).toContain('<name>beta</name>');
    expect(catalog).not.toContain('<name>gamma</name>');
    expect(logs).toContain('filtered: gamma not in agent allowlist');
  });

  test('injection selection coexists with the team directory merge surface: selection only narrows injection, merge/first-wins unchanged', () => {
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

describe('actually injected name set (#1186: onResolved, not the log line)', () => {
  test('kept names = catalog <name>; full names dropped by budget go to omitted, unrendered ones go to unrendered', () => {
    const root = fixtureRoot('resolved-names');
    writeSkill(root, 'keep-me', { name: 'keep-me', description: '留下。' });
    writeSkill(root, 'drop-me', { name: 'drop-me', description: '丢掉。' });
    writeSkill(root, 'quiet', {
      name: 'quiet',
      description: '不进模型目录。',
      disableModelInvocation: true,
    });
    const full = collect(root, ['keep-me', 'drop-me', 'quiet']);
    const fullBytes = Buffer.byteLength(full.catalog, 'utf8');
    const names: { injected: string[]; omitted: string[]; unrendered: string[] }[] = [];
    const catalog = buildSkillsCatalog({
      skillsDir: root,
      cwd: tmpdir(),
      allowlist: ['keep-me', 'drop-me', 'quiet'],
      budgetBytes: fullBytes - 1,
      onResolved: (got) => names.push(got),
    });
    const keptNames = [...catalog.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1]);
    expect(names).toHaveLength(1);
    expect(names[0]?.injected).toEqual(keptNames);
    expect(names[0]?.omitted).toEqual(['drop-me']);
    expect(names[0]?.unrendered).toEqual(['quiet']);
    expect(catalog).not.toContain('<name>quiet</name>');
  });
});
