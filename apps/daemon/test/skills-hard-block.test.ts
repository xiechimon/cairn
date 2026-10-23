// 技能白名单硬挡（#917 口径 4 + spec 14 §技能可见面收归）：白名单从提示级
// （不出现在目录里）升级为硬挡（文件读取被拒）。失败方式清单（先于实现固化）：
//   1. allowlist 缺省（chief 面）误挡 → collectDeniedSkillDirs 返回空集
//   2. 未授权技能目录漏挡（本机 / 团队目录两侧）→ 部分授权 / 空名单两态
//   3. 名单内未知 slug 炸扫描 → 容忍语义（#367 同律）
//   4. 扫描失败（目录缺失）阻断会话 → fail-open 空集（catalog 同律）
//   5. pi 门控 read：未授权路径放行（含 realpath 漂移 / 前缀混淆 / 符号链接
//      绕行三种形态）→ check + operations 双侧断言
//   6. 授权路径被误挡 → 放行且内容逐字节
//   7. 门控整体替换 operations 丢图片面 → detectImageMimeType 必须在位
//   8. claude-code deny 规则形状漂移（Read(//…/**) / Skill(<name>) /
//      Skill(skill:<name>) 三条缺一、元字符未转义）
//   9. sdkOptions 组装回归：settingSources 承重档（'project'）缺失或漂移、
//      chief 面多发 settings 键、实测 inert 的 SDK skills 键复活
//  10. catalog 观测行缺失（entries=0 不落行 = 信号有洞）

import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { describe, expect, test } from 'vitest';
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
  return mkdtempSync(join(tmpdir(), `cairn-hardblock-${tag}-`));
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

// —— collectDeniedSkillDirs（失败方式 1/2/3/4）————————————————————

describe('collectDeniedSkillDirs（spec 14 §裁决后的范围 2：未授权集单源）', () => {
  test('skills 配置缺省 = 空集（不注入面 = 无授权面可挡）', () => {
    expect(collectDeniedSkillDirs(undefined, {})).toEqual([]);
  });

  test('allowlist 缺省（chief 面）= 空集，全量直通零回归', () => {
    const root = fixtureRoot('chief');
    writeSkill(root, 'alpha');
    writeSkill(root, 'beta');
    expect(collectDeniedSkillDirs({ skillsDir: root, cwd: tmpdir() }, {})).toEqual([]);
  });

  test('部分授权 = 名单外条目 baseDir+name 全数在集，名单内不在', () => {
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

  test('空白名单（[]）= 全部扫得条目进拒绝集（least-privilege 纪律）', () => {
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

  test('团队目录同样参与：未授权团队条目在集（授权语义压过来源）', () => {
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

  test('白名单含未知 slug = 容忍不炸（#367 语义），已知条目照常裁决', () => {
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

  test('扫描失败（目录不存在）= fail-open 空集，不阻断会话（catalog 同律）', () => {
    const denied = collectDeniedSkillDirs(
      { skillsDir: join(fixtureRoot('gone'), 'no-such'), cwd: tmpdir() },
      { skillsAllowlist: ['alpha'] },
    );
    expect(denied).toEqual([]);
  });
});

// —— pi 门控 read（失败方式 5/6/7）———————————————————————————————

describe('createSkillReadGate（pi 内建 read 的门控 operations）', () => {
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

  test('未授权 SKILL.md：check 命中条目，readFile/access 拒绝且文案带技能名', async () => {
    const { gate, deniedFile } = gateFixture('basic');
    expect(gate.check(deniedFile)?.name).toBe('beta');
    await expect(gate.operations.readFile(deniedFile)).rejects.toThrow(
      /beta.*not in the agent allowlist/,
    );
    await expect(gate.operations.access(deniedFile)).rejects.toThrow(/not in the agent allowlist/);
  });

  test('授权路径：check 放行，readFile 内容逐字节、access 不抛', async () => {
    const { gate, allowedFile } = gateFixture('allowed');
    expect(gate.check(allowedFile)).toBeNull();
    const buf = await gate.operations.readFile(allowedFile);
    expect(buf.toString('utf8')).toBe('allowed body.');
    await expect(gate.operations.access(allowedFile)).resolves.toBeUndefined();
  });

  test('realpath 漂移（macOS /tmp → /private/tmp）：解析形路径同样被拒', async () => {
    const { gate, deniedFile } = gateFixture('realpath');
    // deniedFile 是 /var 或 /tmp 起头的未解析形；换成 realpath 解析形再试。
    const resolved = realpathSync(deniedFile);
    if (resolved !== deniedFile) {
      expect(gate.check(resolved)?.name).toBe('beta');
      await expect(gate.operations.readFile(resolved)).rejects.toThrow(
        /not in the agent allowlist/,
      );
    } else {
      // 平台无漂移（Linux /tmp 即真路径）：原形已被上一条钉住，此处恒真。
      expect(gate.check(resolved)?.name).toBe('beta');
    }
  });

  test('符号链接绕行：链到未授权文件的链接同样被拒', async () => {
    const { gate, deniedFile } = gateFixture('symlink');
    const link = join(fixtureRoot('symlink-host'), 'innocent.md');
    mkdirSync(join(link, '..'), { recursive: true });
    symlinkSync(deniedFile, link);
    expect(gate.check(link)?.name).toBe('beta');
    await expect(gate.operations.readFile(link)).rejects.toThrow(/not in the agent allowlist/);
  });

  test('前缀混淆：beta-2 目录不在 beta 的拒绝面内（分隔符边界）', () => {
    const root = fixtureRoot('prefix');
    const betaDir = writeSkill(root, 'beta');
    const beta2File = join(writeSkill(root, 'beta-2'), 'SKILL.md');
    const gate = createSkillReadGate([{ name: 'beta', baseDir: betaDir }]);
    expect(gate.check(beta2File)).toBeNull();
    expect(gate.check(join(betaDir, 'SKILL.md'))?.name).toBe('beta');
    // baseDir 自身也在拒绝面内（目录级授权，不只其下文件）。
    expect(gate.check(betaDir)?.name).toBe('beta');
    expect(sep).toBe('/'); // 本仓门控按 posix 分隔符判边界（macOS/Linux daemon）
  });

  test('拒绝时落 denied-read 日志行（带路径与技能名）', async () => {
    const { gate, deniedFile, logs } = gateFixture('log');
    await expect(gate.operations.readFile(deniedFile)).rejects.toThrow();
    expect(logs.some((l) => l.startsWith('denied-read:') && l.includes('beta'))).toBe(true);
    expect(logs.some((l) => l.includes(deniedFile) || l.includes(realpathSync(deniedFile)))).toBe(
      true,
    );
  });

  test('图片面零扰动：operations 三件齐（整体替换语义，detectImageMimeType 在位）', () => {
    const { gate } = gateFixture('image');
    expect(typeof gate.operations.readFile).toBe('function');
    expect(typeof gate.operations.access).toBe('function');
    expect(typeof gate.operations.detectImageMimeType).toBe('function');
  });

  test('空拒绝集 = 恒放行（不注册门控的调用面自证）', () => {
    const gate = createSkillReadGate([]);
    expect(gate.check(join(fixtureRoot('any'), 'x.md'))).toBeNull();
  });
});

// —— claude-code deny 规则面（失败方式 8）——————————————————————————

describe('buildSkillDenyRules / escapeGitignorePath（claude-code 硬挡规则形）', () => {
  test('三条/技能：Read(//<绝对路径>/**) + Skill(<name>) + Skill(skill:<name>)', () => {
    // Read deny 挡不住 Skill 工具的内容加载（verify/917 B4 实测），Skill 名
    // deny 必须独立成规；skill: 前缀形覆盖 alias/display 名（官方语义）。
    const rules = buildSkillDenyRules([{ name: 'beta', baseDir: '/Users/x/.agents/skills/beta' }]);
    expect(rules).toEqual([
      'Read(//Users/x/.agents/skills/beta/**)',
      'Skill(beta)',
      'Skill(skill:beta)',
    ]);
  });

  test('gitignore 元字符转义（[ ] * ? 与反斜杠）只作用于 Read 路径位', () => {
    expect(escapeGitignorePath('/a/b-c')).toBe('/a/b-c');
    expect(escapeGitignorePath('/a/[2026] b*c?d')).toBe('/a/\\[2026\\] b\\*c\\?d');
    const rules = buildSkillDenyRules([{ name: 'x', baseDir: '/a/[weird]' }]);
    expect(rules).toEqual(['Read(//a/\\[weird\\]/**)', 'Skill(x)', 'Skill(skill:x)']);
  });

  test('空拒绝集 = 空规则数组（settings 键不发的判据）', () => {
    expect(buildSkillDenyRules([])).toEqual([]);
  });
});

// —— sdkOptions 组装面（失败方式 9）———————————————————————————————

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

describe('buildClaudeSdkOptions（spec 14 §裁决后的范围 1/2：settingSources + deny 硬挡）', () => {
  test("settingSources 恒钉 ['user','project','local']（'project' = 简报承重位，spec 24）", () => {
    const opts = buildClaudeSdkOptions(baseParts());
    expect(opts.settingSources).toEqual(['user', 'project', 'local']);
    expect(CLAUDE_SETTING_SOURCES).toContain('project');
  });

  test('worker 面：deny 规则进 settings.permissions.deny（flag settings 层）', () => {
    const opts = buildClaudeSdkOptions({
      ...baseParts(),
      skillDenyRules: ['Read(//skills/beta/**)', 'Skill(beta)', 'Skill(skill:beta)'],
    });
    expect(opts.settings).toEqual({
      permissions: { deny: ['Read(//skills/beta/**)', 'Skill(beta)', 'Skill(skill:beta)'] },
    });
  });

  test('SDK skills 键恒不发（实测 inert：只翻译成 allow 规则，bypass 下无效果）', () => {
    expect('skills' in buildClaudeSdkOptions(baseParts())).toBe(false);
    expect(
      'skills' in buildClaudeSdkOptions({ ...baseParts(), skillDenyRules: ['Skill(beta)'] }),
    ).toBe(false);
  });

  test('chief 面：settings 键不发（CLI 默认行为零回归）', () => {
    const opts = buildClaudeSdkOptions(baseParts());
    expect('settings' in opts).toBe(false);
  });

  test('deny 规则空数组 = settings 键不发', () => {
    const opts = buildClaudeSdkOptions({ ...baseParts(), skillDenyRules: [] });
    expect('settings' in opts).toBe(false);
  });

  test('#1148：env 注入 = process.env 展开 + per-step 覆盖（SDK env 整替语义）；缺省不发 env 键', () => {
    // 缺省（无 per-step env）：不设 env 键（subprocess 继承 process.env，现行为）。
    expect('env' in buildClaudeSdkOptions(baseParts())).toBe(false);
    // 注入：SDK env REPLACES（不合并）→ 必须展开 process.env 保 PATH/HOME 等
    // 继承位，per-step 值（CAIRN_PORT_BASE）最后覆盖。
    const opts = buildClaudeSdkOptions({
      ...baseParts(),
      env: { CAIRN_PORT_BASE: '20100' },
    });
    expect(opts.env).toEqual({ ...process.env, CAIRN_PORT_BASE: '20100' });
    expect(opts.env?.CAIRN_PORT_BASE).toBe('20100');
    expect(opts.env?.PATH).toBe(process.env.PATH);
  });

  test('既有面不回归：bypass / disallowedTools / partial / model / cwd / sessionId', () => {
    const opts = buildClaudeSdkOptions(baseParts());
    expect(opts.permissionMode).toBe('bypassPermissions');
    expect(opts.disallowedTools).toEqual(['AskUserQuestion']);
    expect(opts.includePartialMessages).toBe(true);
    expect(opts.model).toBe('claude-test');
    expect(opts.cwd).toBe('/work/tree');
    expect(opts.sessionId).toBe('sid-1');
    expect(opts.resume).toBeUndefined();
  });

  test('resume 面：resumeId 在位发 resume、不发 sessionId', () => {
    const opts = buildClaudeSdkOptions({ ...baseParts(), resumeId: 'prev-1', sessionId: 'sid-x' });
    expect(opts.resume).toBe('prev-1');
    expect(opts.sessionId).toBeUndefined();
  });

  test('systemPrompt append 面（brief 通道后仅无简报后端非空）与 effort 面不变', () => {
    const opts = buildClaudeSdkOptions({ ...baseParts(), append: 'EXTRA', effort: 'high' });
    expect(opts.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code', append: 'EXTRA' });
    expect(opts.effort).toBe('high');
    const bare = buildClaudeSdkOptions(baseParts());
    expect('systemPrompt' in bare).toBe(false);
    expect('effort' in bare).toBe(false);
  });
});

// —— catalog 观测行（失败方式 10）———————————————————————————————

describe('[skills] catalog 观测行（#917 口径 5：目录条数 = 明确信号）', () => {
  test('每次构造都落 catalog: entries=<N> chars=<C> bytes=<B>，entries=0 也落', () => {
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

    // 空白名单 → entries=0：loaded 行缺席但 catalog 行必须在（信号无洞）。
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
