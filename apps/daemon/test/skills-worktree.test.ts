// #1299 skills 执行面联合扫描五态：worktree 侧技能目录（.claude/skills +
// .pi/skills）并入 scanSessionSkills → collectVisibleSkillNames /
// collectVisibleSkillFileMap。失败方式清单（票 #1299 验收映射）：
// 双目录都有 / 仅团队 / 仅 worktree / 同名冲突 / 都无；worktree 目录
// 不存在静默收窄（loadSkills warning 诊断不报错）。

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  buildSkillsCatalog,
  collectVisibleSkillFileMap,
  collectVisibleSkillNames,
  piWorktreeSkillDirs,
} from '../src/backend/skills.js';

function fixtureRoot(tag: string): string {
  return mkdtempSync(join(tmpdir(), `pacman-skills-wt-${tag}-`));
}

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
  writeFileSync(
    join(dir, 'SKILL.md'),
    `${fm.join('\n')}\n${opts.body ?? `${dirName} body.`}\n`,
    'utf8',
  );
  return join(dir, 'SKILL.md');
}

function baseCollectOpts(skillsDir: string, cwd: string) {
  return {
    skillsDir,
    cwd,
    log: undefined as ((msg: string) => void) | undefined,
  };
}

describe('skills 联合扫描（#1299 worktree 侧）', () => {
  test('双目录都有 + worktree 各有技能 → 全部可见', () => {
    const root = fixtureRoot('both');
    const skillsDir = join(root, 'skills');
    mkdirSync(skillsDir, { recursive: true });
    writeSkill(skillsDir, 'team-only', { description: 'team desc' });

    const worktreeDir = join(root, 'worktree');
    mkdirSync(worktreeDir, { recursive: true });
    const wtSkillsDir = join(worktreeDir, '.claude', 'skills');
    mkdirSync(wtSkillsDir, { recursive: true });
    writeSkill(wtSkillsDir, 'wt-only', { description: 'wt desc' });

    const worktreeSkillDirs = piWorktreeSkillDirs(worktreeDir);
    const names = collectVisibleSkillNames({
      ...baseCollectOpts(skillsDir, root),
      worktreeSkillsDirs: worktreeSkillDirs,
    });
    expect(names.has('team-only')).toBe(true);
    expect(names.has('wt-only')).toBe(true);
  });

  test('仅团队目录有技能 → worktree 目录不存在静默收窄', () => {
    const root = fixtureRoot('team-only');
    const skillsDir = join(root, 'skills');
    mkdirSync(skillsDir, { recursive: true });
    writeSkill(skillsDir, 'team-skill', { description: 'team desc' });

    const worktreeDir = join(root, 'no-such-worktree'); // does not exist
    const names = collectVisibleSkillNames({
      ...baseCollectOpts(skillsDir, root),
      worktreeSkillsDirs: piWorktreeSkillDirs(worktreeDir),
    });
    expect(names.has('team-skill')).toBe(true);
    expect(names.size).toBe(1); // only team skill, worktree dir missing silently
  });

  test('仅 worktree 有技能 → PACMAN_SKILLS_DIR 空也可见 worktree 技能', () => {
    const root = fixtureRoot('wt-only');
    const emptySkillsDir = join(root, 'empty-skills');
    mkdirSync(emptySkillsDir, { recursive: true });

    const worktreeDir = join(root, 'worktree');
    const wtSkillsDir = join(worktreeDir, '.claude', 'skills');
    mkdirSync(wtSkillsDir, { recursive: true });
    writeSkill(wtSkillsDir, 'wt-only-skill', { description: 'wt only' });

    const names = collectVisibleSkillNames({
      ...baseCollectOpts(emptySkillsDir, root),
      worktreeSkillsDirs: piWorktreeSkillDirs(worktreeDir),
    });
    expect(names.has('wt-only-skill')).toBe(true);
    expect(names.size).toBe(1);
  });

  test('同名冲突 → 团队/本机条目胜（first-wins），worktree 条目是 loser', () => {
    const root = fixtureRoot('collision');
    const skillsDir = join(root, 'skills');
    mkdirSync(skillsDir, { recursive: true });
    writeSkill(skillsDir, 'shared-skill', { description: 'pacman version' });

    const worktreeDir = join(root, 'worktree');
    const wtSkillsDir = join(worktreeDir, '.claude', 'skills');
    mkdirSync(wtSkillsDir, { recursive: true });
    writeSkill(wtSkillsDir, 'shared-skill', { description: 'worktree version' });

    const fileMap = collectVisibleSkillFileMap({
      ...baseCollectOpts(skillsDir, root),
      worktreeSkillsDirs: piWorktreeSkillDirs(worktreeDir),
    });
    // first-wins: PACMAN_SKILLS_DIR is in skillPaths before worktreeSkillsDirs
    expect(fileMap.has('shared-skill')).toBe(true);
    const path = fileMap.get('shared-skill')!;
    expect(path).toContain('skills/shared-skill/SKILL.md');
    expect(path).not.toContain('.claude');
  });

  test('同名冲突 → buildSkillsCatalog 点 collision 日志 + winner 路径', () => {
    const root = fixtureRoot('collision-log');
    const skillsDir = join(root, 'skills');
    mkdirSync(skillsDir, { recursive: true });
    writeSkill(skillsDir, 'shared-skill', { description: 'pacman version' });

    const worktreeDir = join(root, 'worktree');
    const wtSkillsDir = join(worktreeDir, '.claude', 'skills');
    mkdirSync(wtSkillsDir, { recursive: true });
    writeSkill(wtSkillsDir, 'shared-skill', { description: 'worktree version' });

    const logs: string[] = [];
    const catalog = buildSkillsCatalog({
      skillsDir,
      cwd: root,
      worktreeSkillsDirs: piWorktreeSkillDirs(worktreeDir),
      log: (msg) => logs.push(msg),
    });
    const collisionLog = logs.find((l) => l.startsWith('collision:'));
    expect(collisionLog).toBeDefined();
    expect(collisionLog).toContain('shared-skill');
    // catalog 里条目 name 恒唯一（winner 只出现一次）
    expect(catalog).toContain('shared-skill');
  });

  test('都无 → 空集，不炸', () => {
    const root = fixtureRoot('none');
    const emptySkillsDir = join(root, 'empty');
    mkdirSync(emptySkillsDir, { recursive: true });

    const worktreeDir = join(root, 'no-such-wt');
    const names = collectVisibleSkillNames({
      ...baseCollectOpts(emptySkillsDir, root),
      worktreeSkillsDirs: piWorktreeSkillDirs(worktreeDir),
    });
    expect(names.size).toBe(0);
  });

  test('worktreeSkillsDirs 缺省（旧调用面）→ 仅本机目录扫描，零回归', () => {
    const root = fixtureRoot('legacy');
    const skillsDir = join(root, 'skills');
    mkdirSync(skillsDir, { recursive: true });
    writeSkill(skillsDir, 'legacy-skill', { description: 'old path' });

    const worktreeDir = join(root, 'worktree');
    const wtSkillsDir = join(worktreeDir, '.claude', 'skills');
    mkdirSync(wtSkillsDir, { recursive: true });
    writeSkill(wtSkillsDir, 'new-skill', { description: 'new path' });

    // No worktreeSkillsDirs → only skillsDir scanned
    const names = collectVisibleSkillNames({
      ...baseCollectOpts(skillsDir, root),
    });
    expect(names.has('legacy-skill')).toBe(true);
    expect(names.has('new-skill')).toBe(false); // not in scan surface
  });

  test('piWorktreeSkillDirs 返回 .claude/skills + .pi/skills', () => {
    const dirs = piWorktreeSkillDirs('/tmp/worktree');
    expect(dirs).toHaveLength(2);
    expect(dirs[0]).toBe('/tmp/worktree/.claude/skills');
    expect(dirs[1]).toBe('/tmp/worktree/.pi/skills');
  });
});
