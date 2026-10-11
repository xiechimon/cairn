// 团队技能原生插件通道（#1171）：claude 后端的团队技能经 SDK `plugins`
// 选项（→ CLI `--plugin-dir`）进入 Claude Code 原生 Skill 发现面，落点在
// daemon 缓存 plugins/ 分区——任务 worktree 零写入。失败方式清单先于实现
// 固化（票面纪律；调研实测 = issue #1171 评论 2026-10-11，探针 1-7）：
//   P1  版本闸：executableVersion < 下限 / null / 缺省 → 插件通道跳过 +
//       `native-plugin: skipped` 行（catalog 通道照常）；≥ 下限 → 交付；
//       边界值恰等于下限 = 交付；后缀形（2.1.289-beta.3）按数值段解析
//   P2  deny 面零回退（验收 4）：allowlist 数组 → 插件只含 allowed 条目，
//       名单外技能在插件目录零文件；null → 全量；[]（防御形：view 在位
//       但全被过滤）→ 无插件 + 显式行
//   P3  injectedSkills 不收窄 native 面（#917「选择不越授权」同律）：
//       injectedSkills=[] 而 allowlist 全量 → 插件仍按 allowed 集交付
//   P4  本机 skillsDir 条目不混入插件（插件只承载团队 view 条目）
//   P5  worktree 零写入（验收 2）：resolve 前后 worktree 目录清单不变
//       （验收 3「仓内既有 .claude/skills 不被覆盖」由本条结构性覆盖——
//       插件通道根本不进 worktree；CLI 侧撞名优先序 = 探针 7 实测）
//   P6  pruneCache 不误删 plugins/ 分区（旧形态回收逻辑的新 keep 位）；
//       旧形态残骸回收行为不回归
//   P7  plugins LRU：条目超上限 → 只留最新（mtime）
//   P8  装配失败不阻断步：viewDir 缺失 / dirName 在 view 里不存在 →
//       null + `plugin-failed:` 行，不抛
//   P9  内容寻址幂等：同 (view, allowed 集) 两次调用 → 同一目录、第二次
//       不重建（篡改探针文件保留）；allowed 集不同 → 不同 key
//   P10 hardlink 装配：插件文件与 view 文件同 inode（共享 blob，非复制）
//   P11 plugin.json 形状钉死：name = pacman-team-skills、无 mcpServers 键、
//       插件根无 .mcp.json（skipMcpDiscovery 不发的配套保证——该选项会
//       翻译成 --plugin-dir-no-mcp，版本下限无实证）
//   P12 buildClaudeSdkOptions：plugins 在位 → 原样进 opts；缺省/空数组 →
//       键不发（chief 面与无团队技能面零漂移）
//   P13 realpath 漂移：teamSkillsDir 以 symlink 形传入（macOS /tmp 同形）
//       → 条目仍被识别为 view 内（双侧 realpath 归一，读门同律）
//   P14 dirName 防御位：entries 含 '/' 或 '..' 段 → 跳过该条不装配
//   P15 撞名避让（Multica 原则）：ensure 只写 cacheRoot/plugins 下自建
//       分区，view/blobs 分区零扰动

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MachineSkillsManifestResponse } from '@pacman/shared';
import { describe, expect, test } from 'vitest';
import {
  buildClaudeSdkOptions,
  claudeVersionAtLeast,
  MIN_CLAUDE_PLUGIN_VERSION,
  resolveTeamSkillsPluginDir,
} from '../src/backend/claude-code.js';
import { collectTeamSkillEntries } from '../src/backend/pi.js';
import {
  ensureTeamSkillsPlugin,
  materializeTeamSkills,
  TEAM_SKILLS_PLUGIN_NAME,
} from '../src/team-skills.js';

function fixtureRoot(tag: string): string {
  return mkdtempSync(join(tmpdir(), `pacman-native-plugin-${tag}-`));
}

/** 写一个 skill 目录（<root>/<dirName>/SKILL.md）；返回 baseDir。 */
function writeSkill(root: string, dirName: string, name?: string): string {
  const dir = join(root, dirName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${name ?? dirName}\ndescription: ${dirName} 描述。\n---\n\n${dirName} body.\n`,
    'utf8',
  );
  return dir;
}

/** 伪造一个团队 view 目录（<root>/views/<digest>/<dirName>/SKILL.md）。 */
function makeView(root: string, dirNames: readonly string[], digest = 'deadbeef'): string {
  const view = join(root, 'views', digest);
  for (const d of dirNames) writeSkill(view, d);
  return view;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// —— P1 版本闸（claudeVersionAtLeast 纯函数面）————————————————————

describe('claudeVersionAtLeast（#1050 探测版本 → 插件通道闸）', () => {
  test('下限常量 = 2.1.74（--plugin-dir 最早可证 CHANGELOG 版本）', () => {
    expect(MIN_CLAUDE_PLUGIN_VERSION).toBe('2.1.74');
  });

  test('数值段比较：高于/恰等于/低于下限', () => {
    expect(claudeVersionAtLeast('2.1.294', '2.1.74')).toBe(true);
    expect(claudeVersionAtLeast('2.1.74', '2.1.74')).toBe(true);
    expect(claudeVersionAtLeast('2.1.73', '2.1.74')).toBe(false);
    expect(claudeVersionAtLeast('2.0.12', '2.1.74')).toBe(false);
    expect(claudeVersionAtLeast('3.0.0', '2.1.74')).toBe(true);
    expect(claudeVersionAtLeast('1.9.99', '2.1.74')).toBe(false);
  });

  test('后缀形按数值段解析（2.1.289-beta.3 ≥ 2.1.74）', () => {
    expect(claudeVersionAtLeast('2.1.289-beta.3', '2.1.74')).toBe(true);
  });

  test('null / 缺省 / 不可解析 = false（fail-closed：跳过插件通道，catalog 兜底）', () => {
    expect(claudeVersionAtLeast(null, '2.1.74')).toBe(false);
    expect(claudeVersionAtLeast(undefined, '2.1.74')).toBe(false);
    expect(claudeVersionAtLeast('not-a-version', '2.1.74')).toBe(false);
    expect(claudeVersionAtLeast('2.x.74', '2.1.74')).toBe(false);
  });
});

// —— P2/P3/P4/P13 collectTeamSkillEntries（native 面 allowed 集单源）——

describe('collectTeamSkillEntries（与 catalog/deny 同扫描源的团队条目面）', () => {
  test('teamSkillsDir 缺省 = 空集（纯本机步零变化）', () => {
    const local = fixtureRoot('local');
    writeSkill(local, 'local-a');
    expect(collectTeamSkillEntries({ skillsDir: local, cwd: tmpdir() }, {})).toEqual([]);
  });

  test('skills 配置缺省 = 空集（不注入面）', () => {
    expect(collectTeamSkillEntries(undefined, { teamSkillsDir: '/no/such' })).toEqual([]);
  });

  test('allowlist null（不限制）= 团队条目全量；本机条目不混入（P4）', () => {
    const root = fixtureRoot('full');
    const view = makeView(root, ['team-a', 'team-b']);
    const local = join(root, 'local-skills');
    writeSkill(local, 'local-a');
    const entries = collectTeamSkillEntries(
      { skillsDir: local, cwd: tmpdir() },
      { teamSkillsDir: view },
    );
    expect(entries.map((e) => e.dirName).sort()).toEqual(['team-a', 'team-b']);
    expect(entries.every((e) => e.baseDir.startsWith(view))).toBe(true);
  });

  test('allowlist 数组 = 只留名单内条目（P2 构造面；名单外零条目）', () => {
    const root = fixtureRoot('allow');
    const view = makeView(root, ['team-a', 'team-b', 'team-c']);
    const entries = collectTeamSkillEntries(
      { skillsDir: join(root, 'empty-local'), cwd: tmpdir() },
      { teamSkillsDir: view, skillsAllowlist: ['team-a', 'team-c'] },
    );
    expect(entries.map((e) => e.dirName).sort()).toEqual(['team-a', 'team-c']);
  });

  test('allowlist [] = 空集（显式全拒；runner 面通常 teamSkillsDir 已缺省，此为防御形）', () => {
    const root = fixtureRoot('empty-al');
    const view = makeView(root, ['team-a']);
    expect(
      collectTeamSkillEntries(
        { skillsDir: join(root, 'empty-local'), cwd: tmpdir() },
        { teamSkillsDir: view, skillsAllowlist: [] },
      ),
    ).toEqual([]);
  });

  test('同名冲突团队条目胜（first-wins）→ native 面拿团队版 dirName', () => {
    const root = fixtureRoot('collision');
    const view = makeView(root, ['dup']);
    const local = join(root, 'local-skills');
    writeSkill(local, 'dup');
    const entries = collectTeamSkillEntries(
      { skillsDir: local, cwd: tmpdir() },
      { teamSkillsDir: view },
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.baseDir).toBe(join(view, 'dup'));
  });

  test('realpath 漂移：teamSkillsDir 以 symlink 形传入仍识别（P13，macOS /tmp 同形）', () => {
    const root = fixtureRoot('realpath');
    const view = makeView(root, ['team-a']);
    const viaSymlink = join(tmpdir(), `pacman-sym-view-${sha256(root).slice(0, 8)}`);
    symlinkSync(view, viaSymlink);
    try {
      const entries = collectTeamSkillEntries(
        { skillsDir: join(root, 'empty-local'), cwd: tmpdir() },
        { teamSkillsDir: viaSymlink },
      );
      expect(entries.map((e) => e.dirName)).toEqual(['team-a']);
    } finally {
      // symlink 本身回收（fixture 目录留给 OS tmp 惯例）
      rmSync(viaSymlink, { force: true });
    }
  });

  test('扫描失败（目录缺失）= 空集 fail-open（catalog 同律，不阻断会话）', () => {
    expect(
      collectTeamSkillEntries(
        { skillsDir: '/no/such/local', cwd: tmpdir() },
        { teamSkillsDir: '/no/such/view' },
      ),
    ).toEqual([]);
  });
});

// —— P8/P9/P10/P11/P14/P15/P7 ensureTeamSkillsPlugin（装配面）———————

describe('ensureTeamSkillsPlugin（cacheRoot/plugins 分区装配）', () => {
  test('正常装配：plugin.json + skills/<dirName> 树落位，返回插件目录', () => {
    const root = fixtureRoot('basic');
    const view = makeView(root, ['team-a', 'team-b']);
    const dir = ensureTeamSkillsPlugin({
      cacheRoot: root,
      viewDir: view,
      dirNames: ['team-a', 'team-b'],
    });
    expect(dir).not.toBeNull();
    const manifest = JSON.parse(readFileSync(join(dir!, '.claude-plugin', 'plugin.json'), 'utf8'));
    expect(manifest.name).toBe(TEAM_SKILLS_PLUGIN_NAME);
    expect(readFileSync(join(dir!, 'skills', 'team-a', 'SKILL.md'), 'utf8')).toContain(
      'team-a body',
    );
    expect(readFileSync(join(dir!, 'skills', 'team-b', 'SKILL.md'), 'utf8')).toContain(
      'team-b body',
    );
  });

  test('dirNames 空 = null，零创建（P2 [] 防御形的装配面）', () => {
    const root = fixtureRoot('empty');
    const view = makeView(root, ['team-a']);
    expect(ensureTeamSkillsPlugin({ cacheRoot: root, viewDir: view, dirNames: [] })).toBeNull();
    expect(existsSync(join(root, 'plugins'))).toBe(false);
  });

  test('P10 hardlink 装配：插件文件与 view 文件同 inode（非复制）', () => {
    const root = fixtureRoot('hardlink');
    const view = makeView(root, ['team-a']);
    const dir = ensureTeamSkillsPlugin({ cacheRoot: root, viewDir: view, dirNames: ['team-a'] });
    const a = statSync(join(dir!, 'skills', 'team-a', 'SKILL.md'));
    const b = statSync(join(view, 'team-a', 'SKILL.md'));
    expect(a.ino).toBe(b.ino);
  });

  test('P11 plugin.json 形状：name 钉死、无 mcpServers 键、根无 .mcp.json', () => {
    const root = fixtureRoot('manifest');
    const view = makeView(root, ['team-a']);
    const dir = ensureTeamSkillsPlugin({ cacheRoot: root, viewDir: view, dirNames: ['team-a'] });
    const manifest = JSON.parse(readFileSync(join(dir!, '.claude-plugin', 'plugin.json'), 'utf8'));
    expect(manifest.name).toBe('pacman-team-skills');
    expect('mcpServers' in manifest).toBe(false);
    expect(existsSync(join(dir!, '.mcp.json'))).toBe(false);
    expect(readdirSync(join(dir!)).sort()).toEqual(['.claude-plugin', 'skills']);
  });

  test('P9 内容寻址幂等：同 (view, dirNames) 二次调用同目录、不重建（篡改探针保留）', () => {
    const root = fixtureRoot('idempotent');
    const view = makeView(root, ['team-a']);
    const first = ensureTeamSkillsPlugin({ cacheRoot: root, viewDir: view, dirNames: ['team-a'] });
    const probe = join(first!, 'skills', 'team-a', 'PROBE.txt');
    writeFileSync(probe, 'tampered', 'utf8');
    const second = ensureTeamSkillsPlugin({ cacheRoot: root, viewDir: view, dirNames: ['team-a'] });
    expect(second).toBe(first);
    expect(readFileSync(probe, 'utf8')).toBe('tampered');
  });

  test('P9 allowed 集不同 → 不同 key（同 view 两白名单互不覆写）', () => {
    const root = fixtureRoot('keys');
    const view = makeView(root, ['team-a', 'team-b']);
    const d1 = ensureTeamSkillsPlugin({ cacheRoot: root, viewDir: view, dirNames: ['team-a'] });
    const d2 = ensureTeamSkillsPlugin({
      cacheRoot: root,
      viewDir: view,
      dirNames: ['team-a', 'team-b'],
    });
    expect(d1).not.toBe(d2);
    expect(existsSync(join(d1!, 'skills', 'team-b'))).toBe(false);
    expect(existsSync(join(d2!, 'skills', 'team-b'))).toBe(true);
    // dirNames 顺序无关（key 排序归一）
    const d3 = ensureTeamSkillsPlugin({
      cacheRoot: root,
      viewDir: view,
      dirNames: ['team-b', 'team-a'],
    });
    expect(d3).toBe(d2);
  });

  test('P8 viewDir 缺失 = null + plugin-failed 行，不抛（catalog 通道兜底）', () => {
    const root = fixtureRoot('missing-view');
    const logs: string[] = [];
    const dir = ensureTeamSkillsPlugin({
      cacheRoot: root,
      viewDir: join(root, 'views', 'no-such-digest'),
      dirNames: ['team-a'],
      log: (m) => logs.push(m),
    });
    expect(dir).toBeNull();
    expect(logs.some((l) => l.startsWith('plugin-failed:'))).toBe(true);
    // 失败路径零残留：无 .tmp-* 半写目录
    const pluginsDir = join(root, 'plugins');
    if (existsSync(pluginsDir)) {
      expect(readdirSync(pluginsDir).filter((n) => n.startsWith('.tmp-'))).toEqual([]);
    }
  });

  test('P8 dirName 在 view 里不存在 = null + plugin-failed 行（整插件拒绝，不半装配）', () => {
    const root = fixtureRoot('missing-skill');
    const view = makeView(root, ['team-a']);
    const logs: string[] = [];
    const dir = ensureTeamSkillsPlugin({
      cacheRoot: root,
      viewDir: view,
      dirNames: ['team-a', 'ghost'],
      log: (m) => logs.push(m),
    });
    expect(dir).toBeNull();
    expect(logs.some((l) => l.startsWith('plugin-failed:'))).toBe(true);
  });

  test('P14 不安全 dirName（含 / 或 .. 段）= 跳过该条，其余照常装配', () => {
    const root = fixtureRoot('unsafe-dirname');
    const view = makeView(root, ['team-a']);
    const logs: string[] = [];
    const dir = ensureTeamSkillsPlugin({
      cacheRoot: root,
      viewDir: view,
      dirNames: ['team-a', '../evil', 'a/b'],
      log: (m) => logs.push(m),
    });
    expect(dir).not.toBeNull();
    expect(readdirSync(join(dir!, 'skills'))).toEqual(['team-a']);
    expect(logs.some((l) => l.includes('skipped unsafe dirName'))).toBe(true);
    expect(existsSync(join(root, 'evil'))).toBe(false);
  });

  test('P15 只写自建 plugins/ 分区：views 分区零扰动', () => {
    const root = fixtureRoot('no-touch');
    const view = makeView(root, ['team-a']);
    const before = readdirSync(view).sort();
    const viewMtime = statSync(view).mtimeMs;
    ensureTeamSkillsPlugin({ cacheRoot: root, viewDir: view, dirNames: ['team-a'] });
    expect(readdirSync(view).sort()).toEqual(before);
    expect(statSync(view).mtimeMs).toBe(viewMtime);
    expect(readdirSync(root).sort()).toEqual(['plugins', 'views']);
  });

  test('P7 plugins LRU：超 maxEntries → 只留最新（mtime）', () => {
    const root = fixtureRoot('lru');
    const view = makeView(root, ['team-a', 'team-b', 'team-c']);
    const d1 = ensureTeamSkillsPlugin({
      cacheRoot: root,
      viewDir: view,
      dirNames: ['team-a'],
      maxEntries: 2,
    });
    const past = new Date(Date.now() - 60_000);
    utimesSync(d1!, past, past); // 人为做旧
    ensureTeamSkillsPlugin({
      cacheRoot: root,
      viewDir: view,
      dirNames: ['team-b'],
      maxEntries: 2,
    });
    const d3 = ensureTeamSkillsPlugin({
      cacheRoot: root,
      viewDir: view,
      dirNames: ['team-c'],
      maxEntries: 2,
    });
    expect(existsSync(d1!)).toBe(false);
    expect(existsSync(d3!)).toBe(true);
    expect(readdirSync(join(root, 'plugins'))).toHaveLength(2);
  });

  test('原子落位：成功后 plugins/ 无 .tmp-* 残留', () => {
    const root = fixtureRoot('atomic');
    const view = makeView(root, ['team-a']);
    ensureTeamSkillsPlugin({ cacheRoot: root, viewDir: view, dirNames: ['team-a'] });
    expect(readdirSync(join(root, 'plugins')).filter((n) => n.startsWith('.tmp-'))).toEqual([]);
  });
});

// —— P6 pruneCache keep 集（materializeTeamSkills 集成面）————————————

describe('pruneCache × plugins 分区（P6）', () => {
  function manifestFor(dirNames: readonly string[]): MachineSkillsManifestResponse {
    const content = (d: string): Buffer =>
      Buffer.from(`---\nname: ${d}\ndescription: x\n---\n`, 'utf8');
    return {
      selection: 'all',
      skills: dirNames.map((d) => ({
        id: d,
        name: d,
        description: 'x',
        dirName: d,
        files: [
          {
            path: 'SKILL.md',
            sizeBytes: content(d).byteLength,
            sha256: createHash('sha256').update(content(d)).digest('hex'),
          },
        ],
      })),
    };
  }

  test('materialize 的 prune 不删 plugins/ 分区；旧形态残骸仍被回收', async () => {
    const root = fixtureRoot('prune-keep');
    const fetchFile = async (dirName: string): Promise<Buffer> =>
      Buffer.from(`---\nname: ${dirName}\ndescription: x\n---\n`, 'utf8');
    const view = await materializeTeamSkills({
      cacheRoot: root,
      manifest: manifestFor(['team-a']),
      fetchFile,
    });
    expect(view).not.toBeNull();
    const pluginDir = ensureTeamSkillsPlugin({
      cacheRoot: root,
      viewDir: view!,
      dirNames: ['team-a'],
    });
    // 旧形态残骸（#920 前顶层目录）仍须被回收（M15 回归位）
    mkdirSync(join(root, 'legacy-junk'), { recursive: true });
    // 第二个 manifest 触发新一轮 prune
    await materializeTeamSkills({
      cacheRoot: root,
      manifest: manifestFor(['team-a', 'team-b']),
      fetchFile,
    });
    expect(existsSync(join(root, 'legacy-junk'))).toBe(false);
    expect(existsSync(pluginDir!)).toBe(true);
    expect(readFileSync(join(pluginDir!, 'skills', 'team-a', 'SKILL.md'), 'utf8')).toContain(
      'team-a',
    );
  });
});

// —— P1/P2/P3/P5 resolveTeamSkillsPluginDir（backend 组合面）————————

describe('resolveTeamSkillsPluginDir（claude 后端组合面）', () => {
  interface Harness {
    root: string;
    view: string;
    local: string;
    worktree: string;
    logs: string[];
  }

  function harness(
    tag: string,
    teamDirs: readonly string[],
    localDirs: readonly string[] = [],
  ): Harness {
    const root = fixtureRoot(tag);
    const view = makeView(root, teamDirs);
    const local = join(root, 'local-skills');
    mkdirSync(local, { recursive: true });
    for (const d of localDirs) writeSkill(local, d);
    const worktree = join(root, 'worktree');
    mkdirSync(join(worktree, '.claude', 'skills', 'repo-skill'), { recursive: true });
    writeFileSync(
      join(worktree, '.claude', 'skills', 'repo-skill', 'SKILL.md'),
      '---\nname: repo-skill\ndescription: repo\n---\n',
      'utf8',
    );
    return { root, view, local, worktree, logs: [] };
  }

  function listing(dir: string): string[] {
    const out: string[] = [];
    const walk = (d: string, prefix: string): void => {
      for (const name of readdirSync(d).sort()) {
        out.push(prefix + name);
        const p = join(d, name);
        if (statSync(p).isDirectory()) walk(p, `${prefix}${name}/`);
      }
    };
    walk(dir, '');
    return out;
  }

  test('P1 版本低于下限 = 跳过 + skipped 行；≥ 下限 = 交付', () => {
    const h = harness('gate', ['team-a']);
    const base = {
      skills: { skillsDir: h.local, cwd: h.root },
      cacheRoot: h.root,
      session: { teamSkillsDir: h.view },
      log: (m: string) => h.logs.push(m),
    };
    expect(resolveTeamSkillsPluginDir({ ...base, executableVersion: '2.1.73' })).toBeNull();
    expect(h.logs.some((l) => l.startsWith('native-plugin: skipped'))).toBe(true);
    expect(h.logs.some((l) => l.includes('2.1.73') && l.includes(MIN_CLAUDE_PLUGIN_VERSION))).toBe(
      true,
    );
    h.logs.length = 0;
    expect(resolveTeamSkillsPluginDir({ ...base, executableVersion: null })).toBeNull();
    expect(h.logs.some((l) => l.startsWith('native-plugin: skipped'))).toBe(true);
    h.logs.length = 0;
    const dir = resolveTeamSkillsPluginDir({ ...base, executableVersion: '2.1.294' });
    expect(dir).not.toBeNull();
    expect(h.logs.some((l) => l.startsWith('native-plugin:') && l.includes('1 skill(s)'))).toBe(
      true,
    );
  });

  test('P2 allowlist 数组 = 插件只含 allowed；名单外技能零文件（deny 面零回退）', () => {
    const h = harness('allow', ['team-a', 'team-secret']);
    const dir = resolveTeamSkillsPluginDir({
      skills: { skillsDir: h.local, cwd: h.root },
      cacheRoot: h.root,
      executableVersion: '2.1.294',
      session: { teamSkillsDir: h.view, skillsAllowlist: ['team-a'] },
      log: (m) => h.logs.push(m),
    });
    expect(dir).not.toBeNull();
    expect(readdirSync(join(dir!, 'skills'))).toEqual(['team-a']);
    expect(existsSync(join(dir!, 'skills', 'team-secret'))).toBe(false);
    // 全插件目录树里不存在名单外技能的任何文件
    expect(listing(dir!).some((p) => p.includes('team-secret'))).toBe(false);
  });

  test('P2 allowlist [] = 无插件 + 显式行（不静默）', () => {
    const h = harness('empty-al', ['team-a']);
    const dir = resolveTeamSkillsPluginDir({
      skills: { skillsDir: h.local, cwd: h.root },
      cacheRoot: h.root,
      executableVersion: '2.1.294',
      session: { teamSkillsDir: h.view, skillsAllowlist: [] },
      log: (m) => h.logs.push(m),
    });
    expect(dir).toBeNull();
    expect(h.logs.some((l) => l.startsWith('native-plugin:') && l.includes('0 allowed'))).toBe(
      true,
    );
  });

  test('P3 injectedSkills 不收窄 native 面（选择不越授权）', () => {
    const h = harness('injected', ['team-a', 'team-b']);
    const dir = resolveTeamSkillsPluginDir({
      skills: { skillsDir: h.local, cwd: h.root },
      cacheRoot: h.root,
      executableVersion: '2.1.294',
      session: { teamSkillsDir: h.view, injectedSkills: [] },
      log: (m) => h.logs.push(m),
    });
    expect(dir).not.toBeNull();
    expect(readdirSync(join(dir!, 'skills')).sort()).toEqual(['team-a', 'team-b']);
  });

  test('P5 worktree 零写入：resolve 前后 worktree 清单逐位相同（验收 2/3）', () => {
    const h = harness('clean-worktree', ['team-a'], ['local-x']);
    const before = listing(h.worktree);
    resolveTeamSkillsPluginDir({
      skills: { skillsDir: h.local, cwd: h.root },
      cacheRoot: h.root,
      executableVersion: '2.1.294',
      session: { teamSkillsDir: h.view },
      log: (m) => h.logs.push(m),
    });
    expect(listing(h.worktree)).toEqual(before);
  });

  test('teamSkillsDir 缺省 = null 且零日志（纯本机步无信号噪声）', () => {
    const h = harness('no-team', []);
    const dir = resolveTeamSkillsPluginDir({
      skills: { skillsDir: h.local, cwd: h.root },
      cacheRoot: h.root,
      executableVersion: '2.1.294',
      session: {},
      log: (m) => h.logs.push(m),
    });
    expect(dir).toBeNull();
    expect(h.logs).toEqual([]);
  });

  test('cacheRoot 未接线 = null + skipped 行（接线缺失可见，不静默死）', () => {
    const h = harness('no-cache-root', ['team-a']);
    const dir = resolveTeamSkillsPluginDir({
      skills: { skillsDir: h.local, cwd: h.root },
      cacheRoot: undefined,
      executableVersion: '2.1.294',
      session: { teamSkillsDir: h.view },
      log: (m) => h.logs.push(m),
    });
    expect(dir).toBeNull();
    expect(h.logs.some((l) => l.startsWith('native-plugin: skipped'))).toBe(true);
  });
});

// —— P12 buildClaudeSdkOptions plugins 键 ————————————————

function baseParts() {
  return {
    cwd: '/work/tree',
    modelId: 'claude-test',
    resumeId: null,
    sessionId: 'sid-1',
    disallowedTools: ['AskUserQuestion'],
    mcpServers: {},
    abortController: new AbortController(),
  };
}

describe('buildClaudeSdkOptions × plugins（P12）', () => {
  test('缺省 / 空数组 = plugins 键不发（chief 面与无团队技能面零漂移）', () => {
    expect('plugins' in buildClaudeSdkOptions(baseParts())).toBe(false);
    expect('plugins' in buildClaudeSdkOptions({ ...baseParts(), plugins: [] })).toBe(false);
  });

  test('在位 = 原样进 opts（SDK 默认 pluginDelivery=argv → --plugin-dir）', () => {
    const opts = buildClaudeSdkOptions({
      ...baseParts(),
      plugins: [{ type: 'local', path: '/cache/plugins/key1' }],
    });
    expect(opts.plugins).toEqual([{ type: 'local', path: '/cache/plugins/key1' }]);
    // pluginDelivery 不发：argv 缺省兼容全版本段（initialize 形要求 ≥2.1.261）
    expect('pluginDelivery' in opts).toBe(false);
  });
});
