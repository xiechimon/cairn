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
import type { MachineSkillsManifestResponse } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import {
  buildClaudeSdkOptions,
  claudeVersionAtLeast,
  MIN_CLAUDE_PLUGIN_VERSION,
  resolveTeamSkillsPluginDir,
} from '../src/backend/claude-code.js';
import { collectTeamSkillEntries } from '../src/backend/skills.js';
import {
  ensureTeamSkillsPlugin,
  materializeTeamSkills,
  TEAM_SKILLS_PLUGIN_NAME,
} from '../src/team-skills.js';

function fixtureRoot(tag: string): string {
  return mkdtempSync(join(tmpdir(), `cairn-native-plugin-${tag}-`));
}

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

function makeView(root: string, dirNames: readonly string[], digest = 'deadbeef'): string {
  const view = join(root, 'views', digest);
  for (const d of dirNames) writeSkill(view, d);
  return view;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

describe('claudeVersionAtLeast (#1050 probed version → plugin channel gate)', () => {
  test('floor constant = 2.1.74 (earliest CHANGELOG-provable version with --plugin-dir)', () => {
    expect(MIN_CLAUDE_PLUGIN_VERSION).toBe('2.1.74');
  });

  test('numeric segment comparison: above / exactly at / below the floor', () => {
    expect(claudeVersionAtLeast('2.1.294', '2.1.74')).toBe(true);
    expect(claudeVersionAtLeast('2.1.74', '2.1.74')).toBe(true);
    expect(claudeVersionAtLeast('2.1.73', '2.1.74')).toBe(false);
    expect(claudeVersionAtLeast('2.0.12', '2.1.74')).toBe(false);
    expect(claudeVersionAtLeast('3.0.0', '2.1.74')).toBe(true);
    expect(claudeVersionAtLeast('1.9.99', '2.1.74')).toBe(false);
  });

  test('suffixed forms parsed by numeric segments (2.1.289-beta.3 ≥ 2.1.74)', () => {
    expect(claudeVersionAtLeast('2.1.289-beta.3', '2.1.74')).toBe(true);
  });

  test('null / absent / unparseable = false (fail-closed: skip the plugin channel, catalog fallback)', () => {
    expect(claudeVersionAtLeast(null, '2.1.74')).toBe(false);
    expect(claudeVersionAtLeast(undefined, '2.1.74')).toBe(false);
    expect(claudeVersionAtLeast('not-a-version', '2.1.74')).toBe(false);
    expect(claudeVersionAtLeast('2.x.74', '2.1.74')).toBe(false);
  });
});

describe('collectTeamSkillEntries (team entry surface sharing the catalog/deny scan source)', () => {
  test('teamSkillsDir absent = empty set (zero change for pure-local steps)', () => {
    const local = fixtureRoot('local');
    writeSkill(local, 'local-a');
    expect(collectTeamSkillEntries({ skillsDir: local, cwd: tmpdir() }, {})).toEqual([]);
  });

  test('skills config absent = empty set (no injection surface)', () => {
    expect(collectTeamSkillEntries(undefined, { teamSkillsDir: '/no/such' })).toEqual([]);
  });

  test('allowlist null (unrestricted) = full team entries; local entries not mixed in (P4)', () => {
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

  test('allowlist array = only entries inside the list kept (P2 construction surface; zero entries outside)', () => {
    const root = fixtureRoot('allow');
    const view = makeView(root, ['team-a', 'team-b', 'team-c']);
    const entries = collectTeamSkillEntries(
      { skillsDir: join(root, 'empty-local'), cwd: tmpdir() },
      { teamSkillsDir: view, skillsAllowlist: ['team-a', 'team-c'] },
    );
    expect(entries.map((e) => e.dirName).sort()).toEqual(['team-a', 'team-c']);
  });

  test('allowlist [] = empty set (explicit deny-all; on the runner surface teamSkillsDir is usually already absent, this is the defensive shape)', () => {
    const root = fixtureRoot('empty-al');
    const view = makeView(root, ['team-a']);
    expect(
      collectTeamSkillEntries(
        { skillsDir: join(root, 'empty-local'), cwd: tmpdir() },
        { teamSkillsDir: view, skillsAllowlist: [] },
      ),
    ).toEqual([]);
  });

  test("same-name conflict: team entry wins (first-wins) → native surface takes the team version's dirName", () => {
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

  test('realpath drift: teamSkillsDir passed in symlink form is still recognized (P13, same macOS /tmp shape)', () => {
    const root = fixtureRoot('realpath');
    const view = makeView(root, ['team-a']);
    const viaSymlink = join(tmpdir(), `cairn-sym-view-${sha256(root).slice(0, 8)}`);
    symlinkSync(view, viaSymlink);
    try {
      const entries = collectTeamSkillEntries(
        { skillsDir: join(root, 'empty-local'), cwd: tmpdir() },
        { teamSkillsDir: viaSymlink },
      );
      expect(entries.map((e) => e.dirName)).toEqual(['team-a']);
    } finally {
      rmSync(viaSymlink, { force: true });
    }
  });

  test('scan failure (directory missing) = fail-open empty set (same rule as catalog, does not block the session)', () => {
    expect(
      collectTeamSkillEntries(
        { skillsDir: '/no/such/local', cwd: tmpdir() },
        { teamSkillsDir: '/no/such/view' },
      ),
    ).toEqual([]);
  });
});

describe('ensureTeamSkillsPlugin (cacheRoot/plugins partition assembly)', () => {
  test('normal assembly: plugin.json + skills/<dirName> tree in place, returns the plugin directory', () => {
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

  test('empty dirNames = null, zero creation (assembly surface of the P2 [] defensive shape)', () => {
    const root = fixtureRoot('empty');
    const view = makeView(root, ['team-a']);
    expect(ensureTeamSkillsPlugin({ cacheRoot: root, viewDir: view, dirNames: [] })).toBeNull();
    expect(existsSync(join(root, 'plugins'))).toBe(false);
  });

  test('P10 hardlink assembly: plugin files share the inode with view files (not copies)', () => {
    const root = fixtureRoot('hardlink');
    const view = makeView(root, ['team-a']);
    const dir = ensureTeamSkillsPlugin({ cacheRoot: root, viewDir: view, dirNames: ['team-a'] });
    const a = statSync(join(dir!, 'skills', 'team-a', 'SKILL.md'));
    const b = statSync(join(view, 'team-a', 'SKILL.md'));
    expect(a.ino).toBe(b.ino);
  });

  test('P11 plugin.json shape: name pinned, no mcpServers key, no .mcp.json at the root', () => {
    const root = fixtureRoot('manifest');
    const view = makeView(root, ['team-a']);
    const dir = ensureTeamSkillsPlugin({ cacheRoot: root, viewDir: view, dirNames: ['team-a'] });
    const manifest = JSON.parse(readFileSync(join(dir!, '.claude-plugin', 'plugin.json'), 'utf8'));
    expect(manifest.name).toBe('cairn-team-skills');
    expect('mcpServers' in manifest).toBe(false);
    expect(existsSync(join(dir!, '.mcp.json'))).toBe(false);
    expect(readdirSync(join(dir!)).sort()).toEqual(['.claude-plugin', 'skills']);
  });

  test('P9 content-addressed idempotence: same (view, dirNames) called twice yields the same directory, no rebuild (tamper probe preserved)', () => {
    const root = fixtureRoot('idempotent');
    const view = makeView(root, ['team-a']);
    const first = ensureTeamSkillsPlugin({ cacheRoot: root, viewDir: view, dirNames: ['team-a'] });
    const probe = join(first!, 'skills', 'team-a', 'PROBE.txt');
    writeFileSync(probe, 'tampered', 'utf8');
    const second = ensureTeamSkillsPlugin({ cacheRoot: root, viewDir: view, dirNames: ['team-a'] });
    expect(second).toBe(first);
    expect(readFileSync(probe, 'utf8')).toBe('tampered');
  });

  test('P9 different allowed sets → different keys (two allowlists on the same view never overwrite each other)', () => {
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
    const d3 = ensureTeamSkillsPlugin({
      cacheRoot: root,
      viewDir: view,
      dirNames: ['team-b', 'team-a'],
    });
    expect(d3).toBe(d2);
  });

  test('P8 viewDir missing = null + plugin-failed line, no throw (catalog channel fallback)', () => {
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
    const pluginsDir = join(root, 'plugins');
    if (existsSync(pluginsDir)) {
      expect(readdirSync(pluginsDir).filter((n) => n.startsWith('.tmp-'))).toEqual([]);
    }
  });

  test('P8 dirName not present in the view = null + plugin-failed line (whole plugin refused, no half assembly)', () => {
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

  test('P14 unsafe dirName (contains / or .. segments) = that entry skipped, the rest assembled as usual', () => {
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

  test('P15 writes only the self-owned plugins/ partition: views partition untouched', () => {
    const root = fixtureRoot('no-touch');
    const view = makeView(root, ['team-a']);
    const before = readdirSync(view).sort();
    const viewMtime = statSync(view).mtimeMs;
    ensureTeamSkillsPlugin({ cacheRoot: root, viewDir: view, dirNames: ['team-a'] });
    expect(readdirSync(view).sort()).toEqual(before);
    expect(statSync(view).mtimeMs).toBe(viewMtime);
    expect(readdirSync(root).sort()).toEqual(['plugins', 'views']);
  });

  test('P7 plugins LRU: over maxEntries → keep only the newest (mtime)', () => {
    const root = fixtureRoot('lru');
    const view = makeView(root, ['team-a', 'team-b', 'team-c']);
    const d1 = ensureTeamSkillsPlugin({
      cacheRoot: root,
      viewDir: view,
      dirNames: ['team-a'],
      maxEntries: 2,
    });
    const past = new Date(Date.now() - 60_000);
    utimesSync(d1!, past, past);
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

  test('atomic placement: no .tmp-* residue in plugins/ after success', () => {
    const root = fixtureRoot('atomic');
    const view = makeView(root, ['team-a']);
    ensureTeamSkillsPlugin({ cacheRoot: root, viewDir: view, dirNames: ['team-a'] });
    expect(readdirSync(join(root, 'plugins')).filter((n) => n.startsWith('.tmp-'))).toEqual([]);
  });
});

describe('pruneCache × plugins partition (P6)', () => {
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

  test("materialize's prune does not delete the plugins/ partition; legacy-shape residue is still reclaimed", async () => {
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
    mkdirSync(join(root, 'legacy-junk'), { recursive: true });
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

describe('resolveTeamSkillsPluginDir (claude backend composition surface)', () => {
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

  test('P1 version below floor = skipped + skipped line; ≥ floor = delivered', () => {
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

  test('P2 allowlist array = plugin contains only allowed entries; zero files for skills outside the list (zero fallback on the deny surface)', () => {
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
    expect(listing(dir!).some((p) => p.includes('team-secret'))).toBe(false);
  });

  test('P2 allowlist [] = no plugin + explicit line (not silent)', () => {
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

  test('P3 injectedSkills does not narrow the native surface (selection does not over-authorize)', () => {
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

  test('P5 zero worktree writes: the worktree listing is bit-identical before and after resolve (acceptances 2/3)', () => {
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

  test('teamSkillsDir absent = null and zero logs (no signal noise for pure-local steps)', () => {
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

  test('cacheRoot not wired = null + skipped line (unwired is visible, not a silent dead end)', () => {
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
  test('absent / empty array = plugins key not sent (zero drift on the chief surface and the no-team-skills surface)', () => {
    expect('plugins' in buildClaudeSdkOptions(baseParts())).toBe(false);
    expect('plugins' in buildClaudeSdkOptions({ ...baseParts(), plugins: [] })).toBe(false);
  });

  test('present = enters opts verbatim (SDK default pluginDelivery=argv → --plugin-dir)', () => {
    const opts = buildClaudeSdkOptions({
      ...baseParts(),
      plugins: [{ type: 'local', path: '/cache/plugins/key1' }],
    });
    expect(opts.plugins).toEqual([{ type: 'local', path: '/cache/plugins/key1' }]);
    expect('pluginDelivery' in opts).toBe(false);
  });
});
