import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { openMemoryDb } from '../src/db/client.js';
import { dataMigration } from '../src/db/schema.js';
import { seed } from '../src/db/seed.js';
import { type ChiefToolCtx, executeChiefTool } from '../src/services/chief-tools.js';
import { readSkillSource, writeSkillSource } from '../src/services/skill-source-store.js';
import { rollbackLocalSkillCreate } from '../src/services/skills.js';
import { prepareSkillsHome, SKILLS_HOME_MIGRATION_ID } from '../src/services/skills-home.js';
import { bootServer, req } from './helpers.js';

const roots: string[] = [];
function makeRoot(): string {
  const root = realpathSync(makeTestTempDir('cairn-skills-home-'));
  roots.push(root);
  return root;
}
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function skillMd(name: string, description?: string): string {
  const desc = description === undefined ? '' : `description: ${description}\n`;
  return `---\nname: ${name}\n${desc}---\n# ${name}\n`;
}

function writeSkill(
  root: string,
  dir: string,
  md: string,
  extra: Record<string, Buffer | string> = {},
) {
  mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, dir, 'SKILL.md'), md);
  for (const [path, content] of Object.entries(extra)) {
    mkdirSync(join(root, dir, path, '..'), { recursive: true });
    writeFileSync(join(root, dir, path), content);
  }
}

function snapshot(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const st = lstatSync(full);
      const rel = full.slice(root.length);
      if (st.isSymbolicLink()) out.push(`${rel} -> ${readlinkSync(full)} ${st.mtimeMs}`);
      else if (st.isDirectory()) {
        out.push(`${rel}/ ${st.mtimeMs}`);
        walk(full);
      } else {
        const digest = createHash('sha256').update(readFileSync(full)).digest('hex');
        out.push(`${rel} ${digest} ${st.mtimeMs}`);
      }
    }
  };
  walk(root);
  return out;
}

function world(opts: { existing: boolean }) {
  const base = makeRoot();
  const legacyDir = join(base, 'agents-skills');
  const claudeDir = join(base, 'claude-skills');
  const skillsDir = join(base, 'cairn-home', 'skills');
  const skillSourcesPath = join(base, 'cairn-home', 'server', 'skill-sources.json');
  mkdirSync(legacyDir, { recursive: true });
  mkdirSync(claudeDir, { recursive: true });
  const db = openMemoryDb();
  if (opts.existing) seed(db);
  const run = (pinned = false, dir = skillsDir) =>
    prepareSkillsHome({
      db,
      skillsDir: dir,
      pinned,
      legacyDir,
      skillSourcesPath,
      sharedRoots: [legacyDir, claudeDir],
    });
  const marker = () =>
    db
      .select()
      .from(dataMigration)
      .all()
      .find((r) => r.id === SKILLS_HOME_MIGRATION_ID);
  return { base, legacyDir, skillsDir, skillSourcesPath, db, run, marker };
}

describe('the one-time move to a Cairn-owned skills directory', () => {
  test('a fresh database creates an empty directory, records the marker and copies nothing', async () => {
    const w = world({ existing: false });
    writeSkill(w.legacyDir, 'deploy', skillMd('deploy', '部署'));
    const before = snapshot(w.legacyDir);
    expect(await w.run()).toEqual({ kind: 'fresh' });
    expect(readdirSync(w.skillsDir)).toEqual([]);
    expect(JSON.parse(w.marker()?.detail ?? 'null')).toEqual({ kind: 'fresh' });
    expect(snapshot(w.legacyDir)).toEqual(before);
  });

  test('an existing install copies every legacy skill, records localPath sources and leaves the legacy tree untouched', async () => {
    const w = world({ existing: true });
    const outside = join(w.base, 'dotfiles');
    writeSkill(outside, 'linked', skillMd('linked', '链接来的'));
    symlinkSync(join(outside, 'linked'), join(w.legacyDir, 'linked'));
    writeSkill(w.legacyDir, 'binary', skillMd('binary', '带二进制'), {
      'assets/logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00]),
    });
    writeSkill(w.legacyDir, 'nodesc', skillMd('nodesc'));
    writeSkill(w.legacyDir, 'from-gh', skillMd('from-gh', 'GitHub 导入的'));
    await writeSkillSource(w.skillSourcesPath, {
      skillId: 'from-gh',
      kind: 'github',
      ref: 'https://github.com/o/r/tree/main/from-gh',
      importedAt: 1,
      refreshedAt: null,
    });
    const before = snapshot(w.legacyDir);
    const beforeOutside = snapshot(outside);

    const outcome = await w.run();

    expect(outcome).toMatchObject({ kind: 'migrated', skipped: [] });
    expect(outcome.kind === 'migrated' && [...outcome.copied].sort()).toEqual([
      'binary',
      'from-gh',
      'linked',
      'nodesc',
    ]);
    expect(lstatSync(join(w.skillsDir, 'linked')).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(w.skillsDir, 'binary', 'assets/logo.png'))).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00]),
    );
    expect(existsSync(join(w.skillsDir, '.migrating'))).toBe(false);
    expect(snapshot(w.legacyDir)).toEqual(before);
    expect(snapshot(outside)).toEqual(beforeOutside);
    expect(readSkillSource(w.skillSourcesPath, 'nodesc')).toMatchObject({
      kind: 'localPath',
      ref: join(w.legacyDir, 'nodesc'),
    });
    expect(readSkillSource(w.skillSourcesPath, 'linked')).toMatchObject({
      kind: 'localPath',
      ref: join(outside, 'linked'),
    });
    expect(readSkillSource(w.skillSourcesPath, 'from-gh')).toMatchObject({ kind: 'github' });
    expect(JSON.parse(w.marker()?.detail ?? 'null')).toMatchObject({ kind: 'migrated' });
  });

  test('once the marker exists a later start copies nothing, even when the legacy directory gained a skill', async () => {
    const w = world({ existing: true });
    expect((await w.run()).kind).toBe('migrated');
    writeSkill(w.legacyDir, 'later', skillMd('later', '之后加的'));
    expect(await w.run()).toEqual({ kind: 'done' });
    expect(existsSync(join(w.skillsDir, 'later'))).toBe(false);
  });

  test('CAIRN_SKILLS_DIR set: no copy and no marker', async () => {
    const w = world({ existing: true });
    writeSkill(w.legacyDir, 'deploy', skillMd('deploy', '部署'));
    expect(await w.run(true)).toEqual({ kind: 'pinned' });
    expect(readdirSync(w.skillsDir)).toEqual([]);
    expect(w.marker()).toBeUndefined();
  });

  test('a skill already in the Cairn directory is skipped and keeps its content', async () => {
    const w = world({ existing: true });
    writeSkill(w.legacyDir, 'deploy', skillMd('deploy', '旧目录版'));
    writeSkill(w.skillsDir, 'deploy', skillMd('deploy', 'Cairn 版'));
    const outcome = await w.run();
    expect(outcome).toMatchObject({ kind: 'migrated', copied: [] });
    expect(readFileSync(join(w.skillsDir, 'deploy', 'SKILL.md'), 'utf8')).toContain('Cairn 版');
  });

  test('a stale staging directory from a crashed run is cleared before copying', async () => {
    const w = world({ existing: true });
    writeSkill(w.legacyDir, 'deploy', skillMd('deploy', '部署'));
    writeSkill(join(w.skillsDir, '.migrating'), 'deploy', skillMd('deploy', '半截'));
    expect(await w.run()).toMatchObject({ kind: 'migrated', copied: ['deploy'] });
    expect(readFileSync(join(w.skillsDir, 'deploy', 'SKILL.md'), 'utf8')).toContain('部署');
    expect(existsSync(join(w.skillsDir, '.migrating'))).toBe(false);
  });

  test('a skill holding a link that leaves its own root is skipped whole', async () => {
    const w = world({ existing: true });
    writeSkill(w.legacyDir, 'leaky', skillMd('leaky', '有外链'));
    symlinkSync(w.base, join(w.legacyDir, 'leaky', 'everything'));
    writeSkill(w.legacyDir, 'clean', skillMd('clean', '干净'));
    const outcome = await w.run();
    expect(outcome).toMatchObject({ kind: 'migrated', copied: ['clean'] });
    expect(outcome.kind === 'migrated' && outcome.skipped.map((s) => s.id)).toEqual(['leaky']);
    expect(existsSync(join(w.skillsDir, 'leaky'))).toBe(false);
  });

  test('a skills directory inside a shared root is never created, copied into or marked', async () => {
    const w = world({ existing: true });
    writeSkill(w.legacyDir, 'deploy', skillMd('deploy', '部署'));
    const before = snapshot(w.legacyDir);
    expect(await w.run(false, join(w.legacyDir, 'nested'))).toEqual({ kind: 'shared' });
    expect(await w.run(false, w.legacyDir)).toEqual({ kind: 'shared' });
    expect(snapshot(w.legacyDir)).toEqual(before);
    expect(w.marker()).toBeUndefined();
  });

  test('two starts racing on the marker both succeed', async () => {
    const w = world({ existing: true });
    writeSkill(w.legacyDir, 'deploy', skillMd('deploy', '部署'));
    const outcomes = await Promise.all([w.run(), w.run()]);
    expect(outcomes.every((o) => o.kind === 'migrated')).toBe(true);
    expect(outcomes.flatMap((o) => (o.kind === 'migrated' ? o.copied : []))).toEqual(['deploy']);
    expect(w.marker()).toBeDefined();
    expect(existsSync(join(w.skillsDir, '.migrating'))).toBe(false);
  });
});

describe('Cairn never writes into a skills directory other agent tools share', () => {
  let home: string;
  let previousHome: string | undefined;
  beforeEach(() => {
    previousHome = process.env.HOME;
    home = makeRoot();
    process.env.HOME = home;
  });
  afterEach(() => {
    process.env.HOME = previousHome;
  });

  function sharedWorld() {
    const shared = join(home, '.agents', 'skills');
    writeSkill(shared, 'deploy', skillMd('deploy', '部署'));
    const skillSourcesPath = join(home, 'skill-sources.json');
    const s = bootServer({ skillsDir: shared, skillSourcesPath });
    return { shared, s, skillSourcesPath, before: snapshot(shared) };
  }

  const body = (name: string, description: string) => ({
    name,
    description,
    files: [{ path: 'SKILL.md', content: skillMd(name, description) }],
  });

  test('REST create, update, import and refresh answer 409 and leave the shared tree as it was', async () => {
    const { shared, s, skillSourcesPath, before } = sharedWorld();
    try {
      const outside = join(home, 'src');
      writeSkill(outside, 'fresh', skillMd('fresh', '新的'));
      writeSkill(outside, 'deploy', skillMd('deploy', '源头改了'));
      await writeSkillSource(skillSourcesPath, {
        skillId: 'deploy',
        kind: 'localPath',
        ref: join(outside, 'deploy'),
        importedAt: 1,
        refreshedAt: null,
      });
      const created = await req(s.app, 'POST', '/api/skills', body('made', '新建'));
      expect(created.status).toBe(409);
      const updated = await req(
        s.app,
        'PUT',
        `/api/teams/${s.team.id}/skills/deploy`,
        body('deploy', '改了'),
      );
      expect(updated.status).toBe(409);
      const imported = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/import`, {
        localPath: join(outside, 'fresh'),
      });
      expect(imported.status).toBe(409);
      const refreshed = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/deploy/refresh`);
      expect(refreshed.status).toBe(409);
      expect(snapshot(shared)).toEqual(before);
    } finally {
      s.dispose();
    }
  });

  test('Coordinator create_skill and update_skill answer 409', async () => {
    const { shared, s, before } = sharedWorld();
    try {
      const ctx: ChiefToolCtx = {
        teamId: s.team.id,
        userId: s.user.id,
        chiefId: 'chief-x',
        threadId: 'chief-thread-x',
        chiefAgentId: null,
        conversationId: 'chief-thread-x',
      };
      const deps = {
        db: s.db,
        hub: s.hub,
        machineHub: s.machineHub,
        box: s.secretBox,
        user: s.user,
        reposDir: s.reposDir,
        attachmentsDir: s.attachmentsDir,
        skillsDir: shared,
      };
      await expect(
        executeChiefTool(deps, ctx, 'create_skill', body('chief', '总管')),
      ).rejects.toMatchObject({
        status: 409,
      });
      await expect(
        executeChiefTool(deps, ctx, 'update_skill', { skillId: 'deploy', ...body('deploy', '改') }),
      ).rejects.toMatchObject({ status: 409 });
      expect(snapshot(shared)).toEqual(before);
    } finally {
      s.dispose();
    }
  });

  test('the import rollback refuses to delete inside a shared root', () => {
    const { shared, s, before } = sharedWorld();
    try {
      expect(() => rollbackLocalSkillCreate({ db: s.db, skillsDir: shared }, 'deploy')).toThrow(
        /only reads/,
      );
      expect(snapshot(shared)).toEqual(before);
    } finally {
      s.dispose();
    }
  });

  test('a linked skill in the Cairn directory is refused even when the link chain leaves the shared roots', async () => {
    const elsewhere = join(home, 'dotfiles');
    writeSkill(elsewhere, 'deploy', skillMd('deploy', '原处'));
    const shared = join(home, '.agents', 'skills');
    mkdirSync(shared, { recursive: true });
    symlinkSync(join(elsewhere, 'deploy'), join(shared, 'deploy'));
    const skillsDir = join(home, '.cairn', 'skills');
    mkdirSync(skillsDir, { recursive: true });
    symlinkSync(join(shared, 'deploy'), join(skillsDir, 'deploy'));
    const before = snapshot(elsewhere);
    const s = bootServer({ skillsDir });
    try {
      const res = await req(
        s.app,
        'PUT',
        `/api/teams/${s.team.id}/skills/deploy`,
        body('deploy', '改了'),
      );
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: string }).error).toContain('edit it at its source');
      expect(snapshot(elsewhere)).toEqual(before);
    } finally {
      s.dispose();
    }
  });
});
