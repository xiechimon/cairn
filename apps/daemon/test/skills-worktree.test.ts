import { mkdirSync, writeFileSync } from 'node:fs';

import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  buildSkillsCatalog,
  collectVisibleSkillFileMap,
  collectVisibleSkillNames,
  piWorktreeSkillDirs,
} from '../src/backend/skills.js';

function fixtureRoot(tag: string): string {
  return makeTestTempDir(`cairn-skills-wt-${tag}-`);
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

describe('skills joint scan (#1299 worktree side)', () => {
  test('both directories present + skills in each worktree → all visible', () => {
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

  test('only the team directory has skills → nonexistent worktree directories silently narrow', () => {
    const root = fixtureRoot('team-only');
    const skillsDir = join(root, 'skills');
    mkdirSync(skillsDir, { recursive: true });
    writeSkill(skillsDir, 'team-skill', { description: 'team desc' });

    const worktreeDir = join(root, 'no-such-worktree');
    const names = collectVisibleSkillNames({
      ...baseCollectOpts(skillsDir, root),
      worktreeSkillsDirs: piWorktreeSkillDirs(worktreeDir),
    });
    expect(names.has('team-skill')).toBe(true);
    expect(names.size).toBe(1);
  });

  test('only the worktree has skills → worktree skills visible even with CAIRN_SKILLS_DIR empty', () => {
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

  test('same-name conflict → team/local entry wins (first-wins), worktree entry is the loser', () => {
    const root = fixtureRoot('collision');
    const skillsDir = join(root, 'skills');
    mkdirSync(skillsDir, { recursive: true });
    writeSkill(skillsDir, 'shared-skill', { description: 'cairn version' });

    const worktreeDir = join(root, 'worktree');
    const wtSkillsDir = join(worktreeDir, '.claude', 'skills');
    mkdirSync(wtSkillsDir, { recursive: true });
    writeSkill(wtSkillsDir, 'shared-skill', { description: 'worktree version' });

    const fileMap = collectVisibleSkillFileMap({
      ...baseCollectOpts(skillsDir, root),
      worktreeSkillsDirs: piWorktreeSkillDirs(worktreeDir),
    });
    expect(fileMap.has('shared-skill')).toBe(true);
    const path = fileMap.get('shared-skill')!;
    expect(path).toContain('skills/shared-skill/SKILL.md');
    expect(path).not.toContain('.claude');
  });

  test('same-name conflict → buildSkillsCatalog logs a collision + winner path', () => {
    const root = fixtureRoot('collision-log');
    const skillsDir = join(root, 'skills');
    mkdirSync(skillsDir, { recursive: true });
    writeSkill(skillsDir, 'shared-skill', { description: 'cairn version' });

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
    expect(catalog).toContain('shared-skill');
  });

  test('neither → empty set, no crash', () => {
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

  test('worktreeSkillsDirs absent (old call surface) → only local directories scanned, zero regression', () => {
    const root = fixtureRoot('legacy');
    const skillsDir = join(root, 'skills');
    mkdirSync(skillsDir, { recursive: true });
    writeSkill(skillsDir, 'legacy-skill', { description: 'old path' });

    const worktreeDir = join(root, 'worktree');
    const wtSkillsDir = join(worktreeDir, '.claude', 'skills');
    mkdirSync(wtSkillsDir, { recursive: true });
    writeSkill(wtSkillsDir, 'new-skill', { description: 'new path' });

    const names = collectVisibleSkillNames({
      ...baseCollectOpts(skillsDir, root),
    });
    expect(names.has('legacy-skill')).toBe(true);
    expect(names.has('new-skill')).toBe(false);
  });

  test('piWorktreeSkillDirs returns .claude/skills + .pi/skills', () => {
    const dirs = piWorktreeSkillDirs('/tmp/worktree');
    expect(dirs).toHaveLength(2);
    expect(dirs[0]).toBe('/tmp/worktree/.claude/skills');
    expect(dirs[1]).toBe('/tmp/worktree/.pi/skills');
  });
});
