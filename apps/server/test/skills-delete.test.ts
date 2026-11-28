import {
  type Dirent,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { skillAudit } from '../src/db/schema.js';
import { readSkillSource, writeSkillSource } from '../src/services/skill-source-store.js';
import { bootServer, req } from './helpers.js';

const roots: string[] = [];
function makeRoot(): string {
  const root = makeTestTempDir('cairn-skill-delete-');
  roots.push(root);
  return root;
}
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function skillMd(name: string, description = '示例技能'): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n步骤…\n`;
}

function putSkill(skillsDir: string, dirName: string, name = dirName): string {
  const dir = join(skillsDir, dirName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), skillMd(name));
  return dir;
}

function dirEntries(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .map((entry: Dirent) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function trashInto(root: string): { trash: (path: string) => string; root: string } {
  const trashRoot = join(root, 'Trash');
  return {
    root: trashRoot,
    trash: (path: string) => {
      mkdirSync(trashRoot, { recursive: true });
      const dest = join(trashRoot, basename(path));
      renameSync(path, dest);
      return dest;
    },
  };
}

async function listSkillIds(s: ReturnType<typeof bootServer>): Promise<string[]> {
  const res = await req(s.app, 'GET', `/api/skills?teamId=${s.team.id}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { id: string }[]).map((row) => row.id);
}

describe('DELETE /api/teams/{id}/skills/{sid}', () => {
  test('D1: removes the skill from the list, moves its folder to Trash, drops its import source and audits the delete', async () => {
    const skillsDir = makeRoot();
    const skillSourcesPath = join(makeRoot(), 'skill-sources.json');
    const dir = putSkill(skillsDir, 'deploy');
    const trashRoot = makeRoot();
    const trash = trashInto(trashRoot);
    const s = bootServer({ skillsDir, skillSourcesPath, skillTrash: trash.trash });
    try {
      await writeSkillSource(skillSourcesPath, {
        skillId: 'deploy',
        kind: 'localPath',
        ref: join(makeRoot(), 'source'),
        importedAt: 1,
        refreshedAt: null,
        teamId: s.team.id,
      });
      expect(await listSkillIds(s)).toEqual(['deploy']);
      const res = await req(s.app, 'DELETE', `/api/teams/${s.team.id}/skills/deploy`);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ id: 'deploy', systemTrash: true });
      expect(existsSync(dir)).toBe(false);
      expect(await listSkillIds(s)).toEqual([]);
      const trashed = join(trash.root, 'deploy');
      expect(readFileSync(join(trashed, 'SKILL.md'), 'utf8')).toContain('name: deploy');
      expect(readSkillSource(skillSourcesPath, 'deploy')).toBeNull();
      const audit = s.db.select().from(skillAudit).all();
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        skillId: 'deploy',
        actorType: 'member',
        action: 'delete',
      });
    } finally {
      s.dispose();
    }
  });

  test('D2: a second delete answers 404 and leaves the Trash copy alone', async () => {
    const skillsDir = makeRoot();
    const trash = trashInto(makeRoot());
    const s = bootServer({ skillsDir, skillTrash: trash.trash });
    try {
      putSkill(skillsDir, 'deploy');
      expect((await req(s.app, 'DELETE', `/api/teams/${s.team.id}/skills/deploy`)).status).toBe(
        200,
      );
      const second = await req(s.app, 'DELETE', `/api/teams/${s.team.id}/skills/deploy`);
      expect(second.status).toBe(404);
      expect(((await second.json()) as { error?: string }).error).toContain('deploy');
    } finally {
      s.dispose();
    }
  });

  test('D3: deleting an imported skill never touches the folder it was imported from', async () => {
    const source = makeRoot();
    mkdirSync(join(source, 'imported-skill'));
    writeFileSync(
      join(source, 'imported-skill', 'SKILL.md'),
      skillMd('imported-skill', '导入的技能'),
    );
    writeFileSync(join(source, 'imported-skill', 'NOTES.md'), '本地笔记\n');
    const skillsDir = makeRoot();
    const skillSourcesPath = join(makeRoot(), 'skill-sources.json');
    const s = bootServer({
      skillsDir,
      skillSourcesPath,
      skillTrash: trashInto(makeRoot()).trash,
    });
    try {
      const imported = await req(s.app, 'POST', `/api/teams/${s.team.id}/skills/import`, {
        localPath: join(source, 'imported-skill'),
      });
      expect(imported.status).toBe(201);
      expect(
        (await req(s.app, 'DELETE', `/api/teams/${s.team.id}/skills/imported-skill`)).status,
      ).toBe(200);
      expect(existsSync(join(skillsDir, 'imported-skill'))).toBe(false);
      expect(readFileSync(join(source, 'imported-skill', 'SKILL.md'), 'utf8')).toBe(
        skillMd('imported-skill', '导入的技能'),
      );
      expect(readFileSync(join(source, 'imported-skill', 'NOTES.md'), 'utf8')).toBe('本地笔记\n');
    } finally {
      s.dispose();
    }
  });

  test('D4: a skills directory that other agent tools share is refused with 409 and keeps the skill', async () => {
    const home = makeRoot();
    const previousHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const shared = join(home, '.agents', 'skills');
      const dir = putSkill(shared, 'deploy');
      const s = bootServer({ skillsDir: shared, skillTrash: trashInto(makeRoot()).trash });
      try {
        const res = await req(s.app, 'DELETE', `/api/teams/${s.team.id}/skills/deploy`);
        expect(res.status).toBe(409);
        expect(((await res.json()) as { error?: string }).error).toContain('refusing to delete');
        expect(dirEntries(dir)).toEqual(['SKILL.md']);
        expect(await listSkillIds(s)).toEqual(['deploy']);
      } finally {
        s.dispose();
      }
    } finally {
      process.env.HOME = previousHome;
    }
  });

  test('D6: a directory that only looks like a skill through a link is not what a delete reaches for; the real folder goes and the link is left dangling', async () => {
    const skillsDir = makeRoot();
    const dir = putSkill(skillsDir, 'deploy');
    symlinkSync(dir, join(skillsDir, 'a-alias'));
    const trash = trashInto(makeRoot());
    const s = bootServer({ skillsDir, skillTrash: trash.trash });
    try {
      expect(await listSkillIds(s)).toEqual(['deploy']);
      expect((await req(s.app, 'DELETE', `/api/teams/${s.team.id}/skills/deploy`)).status).toBe(
        200,
      );
      expect(existsSync(dir)).toBe(false);
      expect(readFileSync(join(trash.root, 'deploy', 'SKILL.md'), 'utf8')).toContain(
        'name: deploy',
      );
      expect(await listSkillIds(s)).toEqual([]);
    } finally {
      s.dispose();
    }
  });

  test('D7: a download that reaches for the skill after the delete answers 404, so that step fails loudly instead of running with half the skill', async () => {
    const skillsDir = makeRoot();
    putSkill(skillsDir, 'deploy');
    const s = bootServer({ skillsDir, skillTrash: trashInto(makeRoot()).trash });
    try {
      const file = `/api/teams/${s.team.id}/skills/deploy/file?fileName=SKILL.md`;
      expect((await req(s.app, 'GET', file)).status).toBe(200);
      expect((await req(s.app, 'DELETE', `/api/teams/${s.team.id}/skills/deploy`)).status).toBe(
        200,
      );
      const late = await req(s.app, 'GET', file);
      expect(late.status).toBe(404);
      expect(((await late.json()) as { error?: string }).error).toContain('deploy');
      expect(await listSkillIds(s)).toEqual([]);
    } finally {
      s.dispose();
    }
  });

  test('D5: when the Trash move fails the request answers 500 and the skill stays in place', async () => {
    const skillsDir = makeRoot();
    const dir = putSkill(skillsDir, 'deploy');
    const s = bootServer({
      skillsDir,
      skillTrash: () => {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      },
    });
    try {
      const res = await req(s.app, 'DELETE', `/api/teams/${s.team.id}/skills/deploy`);
      expect(res.status).toBe(500);
      expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toContain('name: deploy');
      expect(await listSkillIds(s)).toEqual(['deploy']);
    } finally {
      s.dispose();
    }
  });
});
