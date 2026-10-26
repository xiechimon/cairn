import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { describe, expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  buildClaudeSdkOptions,
  buildSkillDenyRules,
  CLAUDE_SETTING_SOURCES,
  escapeGitignorePath,
} from '../src/backend/claude-code.js';
import {
  buildSkillsCatalog,
  collectDeniedSkillDirs,
  createSkillReadGate,
  type DeniedSkillEntry,
} from '../src/backend/skills.js';

function fixtureRoot(tag: string): string {
  return makeTestTempDir(`cairn-hardblock-${tag}-`);
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

describe('collectDeniedSkillDirs (spec 14 §post-ruling scope 2: unauthorized set single source)', () => {
  test('skills config absent = empty set (no injection surface = nothing for the authorization surface to block)', () => {
    expect(collectDeniedSkillDirs(undefined, {})).toEqual([]);
  });

  test('allowlist absent (chief surface) = empty set, full passthrough with zero regression', () => {
    const root = fixtureRoot('chief');
    writeSkill(root, 'alpha');
    writeSkill(root, 'beta');
    expect(collectDeniedSkillDirs({ skillsDir: root, cwd: tmpdir() }, {})).toEqual([]);
  });

  test('partial authorization = entries outside the list are all in the set by baseDir+name, entries inside are not', () => {
    const root = fixtureRoot('partial');
    const beta = writeSkill(root, 'beta');
    writeSkill(root, 'alpha');
    const denied = collectDeniedSkillDirs(
      { skillsDir: root, cwd: tmpdir() },
      {
        skillsAllowlist: ['alpha'],
      },
    );
    expect(denied).toEqual([{ name: 'beta', baseDir: beta }]);
  });

  test('empty allowlist ([]) = every scanned entry enters the denial set (least-privilege discipline)', () => {
    const root = fixtureRoot('empty-al');
    writeSkill(root, 'alpha');
    writeSkill(root, 'beta');
    const denied = collectDeniedSkillDirs(
      { skillsDir: root, cwd: tmpdir() },
      {
        skillsAllowlist: [],
      },
    );
    expect(denied.map((d) => d.name).sort()).toEqual(['alpha', 'beta']);
  });

  test('team directories participate too: unauthorized team entries are in the set (authorization semantics override origin)', () => {
    const local = fixtureRoot('team-local');
    const team = fixtureRoot('team-team');
    writeSkill(local, 'local-a');
    const teamB = writeSkill(team, 'team-b');
    const denied = collectDeniedSkillDirs(
      { skillsDir: local, cwd: tmpdir() },
      {
        skillsAllowlist: ['local-a'],
        teamSkillsDir: team,
      },
    );
    expect(denied).toEqual([{ name: 'team-b', baseDir: teamB }]);
  });

  test('allowlist containing an unknown slug = tolerated without crashing (#367 semantics), known entries adjudicated as usual', () => {
    const root = fixtureRoot('ghost');
    writeSkill(root, 'alpha');
    const beta = writeSkill(root, 'beta');
    const denied = collectDeniedSkillDirs(
      { skillsDir: root, cwd: tmpdir() },
      {
        skillsAllowlist: ['alpha', 'ghost-slug'],
      },
    );
    expect(denied).toEqual([{ name: 'beta', baseDir: beta }]);
  });

  test('scan failure (directory missing) = fail-open empty set, does not block the session (same rule as catalog)', () => {
    const denied = collectDeniedSkillDirs(
      { skillsDir: join(fixtureRoot('gone'), 'no-such'), cwd: tmpdir() },
      { skillsAllowlist: ['alpha'] },
    );
    expect(denied).toEqual([]);
  });
});

describe("createSkillReadGate (gated operations over pi's built-in read)", () => {
  function gateFixture(tag: string): {
    gate: ReturnType<typeof createSkillReadGate>;
    deniedFile: string;
    allowedFile: string;
    logs: string[];
  } {
    const skillsRoot = fixtureRoot(`${tag}-skills`);
    const deniedDir = writeSkill(skillsRoot, 'beta');
    const work = fixtureRoot(`${tag}-work`);
    const allowedFile = join(work, 'notes.md');
    writeFileSync(allowedFile, 'allowed body.', 'utf8');
    const logs: string[] = [];
    const denied: DeniedSkillEntry[] = [{ name: 'beta', baseDir: deniedDir }];
    return {
      gate: createSkillReadGate(denied, (m) => logs.push(m)),
      deniedFile: join(deniedDir, 'SKILL.md'),
      allowedFile,
      logs,
    };
  }

  test('unauthorized SKILL.md: check hits the entry, readFile/access refuse with wording carrying the skill name', async () => {
    const { gate, deniedFile } = gateFixture('basic');
    expect(gate.check(deniedFile)?.name).toBe('beta');
    await expect(gate.operations.readFile(deniedFile)).rejects.toThrow(
      /beta.*not in the agent allowlist/,
    );
    await expect(gate.operations.access(deniedFile)).rejects.toThrow(/not in the agent allowlist/);
  });

  test('authorized path: check allows, readFile content byte for byte, access does not throw', async () => {
    const { gate, allowedFile } = gateFixture('allowed');
    expect(gate.check(allowedFile)).toBeNull();
    const buf = await gate.operations.readFile(allowedFile);
    expect(buf.toString('utf8')).toBe('allowed body.');
    await expect(gate.operations.access(allowedFile)).resolves.toBeUndefined();
  });

  test('realpath drift (macOS /tmp → /private/tmp): the resolved path form is refused too', async () => {
    const { gate, deniedFile } = gateFixture('realpath');
    const resolved = realpathSync(deniedFile);
    if (resolved !== deniedFile) {
      expect(gate.check(resolved)?.name).toBe('beta');
      await expect(gate.operations.readFile(resolved)).rejects.toThrow(
        /not in the agent allowlist/,
      );
    } else {
      expect(gate.check(resolved)?.name).toBe('beta');
    }
  });

  test('symlink bypass: links pointing to unauthorized files are refused too', async () => {
    const { gate, deniedFile } = gateFixture('symlink');
    const link = join(fixtureRoot('symlink-host'), 'innocent.md');
    mkdirSync(join(link, '..'), { recursive: true });
    symlinkSync(deniedFile, link);
    expect(gate.check(link)?.name).toBe('beta');
    await expect(gate.operations.readFile(link)).rejects.toThrow(/not in the agent allowlist/);
  });

  test("prefix confusion: the beta-2 directory is not inside beta's denial surface (separator boundary)", () => {
    const root = fixtureRoot('prefix');
    const betaDir = writeSkill(root, 'beta');
    const beta2File = join(writeSkill(root, 'beta-2'), 'SKILL.md');
    const gate = createSkillReadGate([{ name: 'beta', baseDir: betaDir }]);
    expect(gate.check(beta2File)).toBeNull();
    expect(gate.check(join(betaDir, 'SKILL.md'))?.name).toBe('beta');
    expect(gate.check(betaDir)?.name).toBe('beta');
    expect(sep).toBe('/');
  });

  test('refusal lands a denied-read log line (with path and skill name)', async () => {
    const { gate, deniedFile, logs } = gateFixture('log');
    await expect(gate.operations.readFile(deniedFile)).rejects.toThrow();
    expect(logs.some((l) => l.startsWith('denied-read:') && l.includes('beta'))).toBe(true);
    expect(logs.some((l) => l.includes(deniedFile) || l.includes(realpathSync(deniedFile)))).toBe(
      true,
    );
  });

  test('image surface untouched: all three operations present (whole-replacement semantics, detectImageMimeType intact)', () => {
    const { gate } = gateFixture('image');
    expect(typeof gate.operations.readFile).toBe('function');
    expect(typeof gate.operations.access).toBe('function');
    expect(typeof gate.operations.detectImageMimeType).toBe('function');
  });

  test('empty denial set = always allow (the call surface that registers no gate proves itself)', () => {
    const gate = createSkillReadGate([]);
    expect(gate.check(join(fixtureRoot('any'), 'x.md'))).toBeNull();
  });
});

describe('buildSkillDenyRules / escapeGitignorePath (claude-code hard-block rule shape)', () => {
  test('three rules per skill: Read(//<absolute path>/**) + Skill(<name>) + Skill(skill:<name>)', () => {
    const rules = buildSkillDenyRules([{ name: 'beta', baseDir: '/Users/x/.agents/skills/beta' }]);
    expect(rules).toEqual([
      'Read(//Users/x/.agents/skills/beta/**)',
      'Skill(beta)',
      'Skill(skill:beta)',
    ]);
  });

  test('gitignore metacharacter escaping ([ ] * ? and backslash) applies only to the Read path slot', () => {
    expect(escapeGitignorePath('/a/b-c')).toBe('/a/b-c');
    expect(escapeGitignorePath('/a/[2026] b*c?d')).toBe('/a/\\[2026\\] b\\*c\\?d');
    const rules = buildSkillDenyRules([{ name: 'x', baseDir: '/a/[weird]' }]);
    expect(rules).toEqual(['Read(//a/\\[weird\\]/**)', 'Skill(x)', 'Skill(skill:x)']);
  });

  test('empty denial set = empty rule array (the criterion for not sending the settings key)', () => {
    expect(buildSkillDenyRules([])).toEqual([]);
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

describe('buildClaudeSdkOptions (spec 14 §post-ruling scope 1/2: settingSources + deny hard block)', () => {
  test("settingSources always pinned to ['user','project','local'] ('project' = the brief-bearing slot, spec 24)", () => {
    const opts = buildClaudeSdkOptions(baseParts());
    expect(opts.settingSources).toEqual(['user', 'project', 'local']);
    expect(CLAUDE_SETTING_SOURCES).toContain('project');
  });

  test('worker surface: deny rules enter settings.permissions.deny (flag settings layer)', () => {
    const opts = buildClaudeSdkOptions({
      ...baseParts(),
      skillDenyRules: ['Read(//skills/beta/**)', 'Skill(beta)', 'Skill(skill:beta)'],
    });
    expect(opts.settings).toEqual({
      permissions: { deny: ['Read(//skills/beta/**)', 'Skill(beta)', 'Skill(skill:beta)'] },
    });
  });

  test('SDK skills key never sent (measured inert: only translated into allow rules, no effect under bypass)', () => {
    expect('skills' in buildClaudeSdkOptions(baseParts())).toBe(false);
    expect(
      'skills' in buildClaudeSdkOptions({ ...baseParts(), skillDenyRules: ['Skill(beta)'] }),
    ).toBe(false);
  });

  test('chief surface: settings key not sent (zero regression on CLI default behavior)', () => {
    const opts = buildClaudeSdkOptions(baseParts());
    expect('settings' in opts).toBe(false);
  });

  test('empty deny rule array = settings key not sent', () => {
    const opts = buildClaudeSdkOptions({ ...baseParts(), skillDenyRules: [] });
    expect('settings' in opts).toBe(false);
  });

  test('#1148: env injection = process.env expansion + per-step overrides (SDK env whole-replacement semantics); env key not sent by default', () => {
    expect('env' in buildClaudeSdkOptions(baseParts())).toBe(false);
    const opts = buildClaudeSdkOptions({
      ...baseParts(),
      env: { CAIRN_PORT_BASE: '20100' },
    });
    expect(opts.env).toEqual({ ...process.env, CAIRN_PORT_BASE: '20100' });
    expect(opts.env?.CAIRN_PORT_BASE).toBe('20100');
    expect(opts.env?.PATH).toBe(process.env.PATH);
  });

  test('existing surfaces unregressed: bypass / disallowedTools / partial / model / cwd / sessionId', () => {
    const opts = buildClaudeSdkOptions(baseParts());
    expect(opts.permissionMode).toBe('bypassPermissions');
    expect(opts.disallowedTools).toEqual(['AskUserQuestion']);
    expect(opts.includePartialMessages).toBe(true);
    expect(opts.model).toBe('claude-test');
    expect(opts.cwd).toBe('/work/tree');
    expect(opts.sessionId).toBe('sid-1');
    expect(opts.resume).toBeUndefined();
  });

  test('resume surface: resumeId present sends resume, not sessionId', () => {
    const opts = buildClaudeSdkOptions({ ...baseParts(), resumeId: 'prev-1', sessionId: 'sid-x' });
    expect(opts.resume).toBe('prev-1');
    expect(opts.sessionId).toBeUndefined();
  });

  test('systemPrompt append surface (after the brief channel, non-empty only for backends without a brief) and the effort surface unchanged', () => {
    const opts = buildClaudeSdkOptions({ ...baseParts(), append: 'EXTRA', effort: 'high' });
    expect(opts.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code', append: 'EXTRA' });
    expect(opts.effort).toBe('high');
    const bare = buildClaudeSdkOptions(baseParts());
    expect('systemPrompt' in bare).toBe(false);
    expect('effort' in bare).toBe(false);
  });
});

describe('[skills] catalog observation line (#917 reading 5: catalog entry count = an explicit signal)', () => {
  test('every construction lands catalog: entries=<N> chars=<C> bytes=<B>, entries=0 included', () => {
    const root = fixtureRoot('observe');
    writeSkill(root, 'alpha');
    const logsFull: string[] = [];
    const catalog = buildSkillsCatalog({
      skillsDir: root,
      cwd: tmpdir(),
      log: (m) => logsFull.push(m),
    });
    expect(logsFull).toContain(
      `catalog: entries=1 chars=${catalog.length} bytes=${Buffer.byteLength(catalog, 'utf8')}`,
    );

    const logsZero: string[] = [];
    buildSkillsCatalog({
      skillsDir: root,
      cwd: tmpdir(),
      allowlist: [],
      log: (m) => logsZero.push(m),
    });
    expect(logsZero).toContain('catalog: entries=0 chars=0 bytes=0');
  });
});
