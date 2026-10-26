import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';

import { join } from 'node:path';
import type { MachineSkillsManifestResponse } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  materializeTeamSkills,
  TEAM_SKILLS_BLOB_MAX_ENTRIES,
  TEAM_SKILLS_CACHE_MAX_ENTRIES,
  TeamSkillsError,
} from '../src/team-skills.js';

function cacheRoot(tag: string): string {
  return join(makeTestTempDir(`cairn-team-skills-${tag}-`), 'team-skills');
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function fileEntry(
  path: string,
  content: string | Buffer,
): MachineSkillsManifestResponse['skills'][number]['files'][number] {
  const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  return { path, sizeBytes: bytes.byteLength, sha256: sha256(bytes) };
}

function manifest(
  skills: MachineSkillsManifestResponse['skills'],
  selection: MachineSkillsManifestResponse['selection'] = 'whitelist',
): MachineSkillsManifestResponse {
  return { selection, skills };
}

function demoSkill(marker: string): MachineSkillsManifestResponse['skills'][number] {
  return {
    id: 'deploy-demo',
    name: 'deploy-demo',
    description: '演示部署技能。',
    dirName: 'deploy-demo',
    files: [
      fileEntry(
        'SKILL.md',
        `---\nname: deploy-demo\ndescription: 演示部署技能。\n---\n\n${marker}\n`,
      ),
      fileEntry('refs/runbook.md', `${marker} runbook\n`),
    ],
  };
}

function fetcherFrom(contents: Record<string, string | Buffer>): {
  fetchFile: (dirName: string, path: string) => Promise<Buffer>;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    fetchFile: async (dirName, path) => {
      const key = `${dirName}/${path}`;
      calls.push(key);
      const content = contents[key];
      if (content === undefined) throw new Error(`no stub content for ${key}`);
      return typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
    },
  };
}

function demoContents(marker: string): Record<string, string> {
  return {
    'deploy-demo/SKILL.md': `---\nname: deploy-demo\ndescription: 演示部署技能。\n---\n\n${marker}\n`,
    'deploy-demo/refs/runbook.md': `${marker} runbook\n`,
  };
}

function collectLogs(): { logs: string[]; log: (msg: string) => void } {
  const logs: string[] = [];
  return { logs, log: (msg) => logs.push(msg) };
}

describe('materializeTeamSkills (M1–M16, #920 manifest + on-demand fetch)', () => {
  test('M1 normal manifest → view directory + files on disk byte for byte (including nested paths) + materialized log line', async () => {
    const root = cacheRoot('m1');
    const { logs, log } = collectLogs();
    const fetcher = fetcherFrom(demoContents('v1'));
    const dir = await materializeTeamSkills({
      cacheRoot: root,
      manifest: manifest([demoSkill('v1')]),
      fetchFile: fetcher.fetchFile,
      log,
    });
    expect(dir).not.toBeNull();
    expect(readFileSync(join(dir!, 'deploy-demo', 'SKILL.md'), 'utf8')).toContain('v1');
    expect(readFileSync(join(dir!, 'deploy-demo', 'refs', 'runbook.md'), 'utf8')).toBe(
      'v1 runbook\n',
    );
    expect(fetcher.calls.sort()).toEqual(['deploy-demo/SKILL.md', 'deploy-demo/refs/runbook.md']);
    expect(logs.some((l) => l.startsWith('team: 1 skill(s), 2 file(s) materialized'))).toBe(true);
    expect(logs.some((l) => l.includes('fetched 2 file(s)') && l.includes('reused 0'))).toBe(true);
  });

  test.each(['whitelist', 'all'] as const)(
    'M2 空清单 selection=%s → null + team-manifest-empty 显式行 + cacheRoot 零创建',
    async (selection) => {
      const root = cacheRoot('m2');
      const { logs, log } = collectLogs();
      const fetcher = fetcherFrom({});
      const dir = await materializeTeamSkills({
        cacheRoot: root,
        manifest: manifest([], selection),
        fetchFile: fetcher.fetchFile,
        log,
      });
      expect(dir).toBeNull();
      expect(existsSync(root)).toBe(false);
      expect(fetcher.calls).toEqual([]);
      expect(
        logs.some(
          (l) => l.startsWith('team-manifest-empty:') && l.includes(`selection=${selection}`),
        ),
      ).toBe(true);
    },
  );

  test('M3 rematerializing the same manifest → same directory, zero fetches (mtime probe unchanged) + cache hit line', async () => {
    const root = cacheRoot('m3');
    const m = manifest([demoSkill('v1')]);
    const first = fetcherFrom(demoContents('v1'));
    const dirA = await materializeTeamSkills({
      cacheRoot: root,
      manifest: m,
      fetchFile: first.fetchFile,
    });
    const probe = join(dirA!, 'deploy-demo', 'SKILL.md');
    const old = new Date(Date.now() - 60_000);
    utimesSync(probe, old, old);
    const second = fetcherFrom(demoContents('v1'));
    const { logs, log } = collectLogs();
    const dirB = await materializeTeamSkills({
      cacheRoot: root,
      manifest: m,
      fetchFile: second.fetchFile,
      log,
    });
    expect(dirB).toBe(dirA);
    expect(second.calls).toEqual([]);
    expect(readFileSync(probe, 'utf8')).toContain('v1');
    const mtime = statSync(probe).mtime;
    expect(Math.abs(mtime.getTime() - old.getTime())).toBeLessThan(1_000);
    expect(logs.some((l) => l.startsWith('team: 1 skill(s) cache hit'))).toBe(true);
  });

  test('M4 single file change → new view directory coexists; only the changed file fetched (fetch=1 / reused=1)', async () => {
    const root = cacheRoot('m4');
    const dirA = await materializeTeamSkills({
      cacheRoot: root,
      manifest: manifest([demoSkill('v1')]),
      fetchFile: fetcherFrom(demoContents('v1')).fetchFile,
    });
    const v2Skill: MachineSkillsManifestResponse['skills'][number] = {
      ...demoSkill('v1'),
      files: [fileEntry('SKILL.md', 'changed entry\n'), demoSkill('v1').files[1]!],
    };
    const { logs, log } = collectLogs();
    const second = fetcherFrom({ 'deploy-demo/SKILL.md': 'changed entry\n' });
    const dirB = await materializeTeamSkills({
      cacheRoot: root,
      manifest: manifest([v2Skill]),
      fetchFile: second.fetchFile,
      log,
    });
    expect(dirB).not.toBe(dirA);
    expect(readFileSync(join(dirA!, 'deploy-demo', 'SKILL.md'), 'utf8')).toContain('v1');
    expect(readFileSync(join(dirB!, 'deploy-demo', 'SKILL.md'), 'utf8')).toBe('changed entry\n');
    expect(readFileSync(join(dirB!, 'deploy-demo', 'refs', 'runbook.md'), 'utf8')).toBe(
      'v1 runbook\n',
    );
    expect(second.calls).toEqual(['deploy-demo/SKILL.md']);
    expect(logs.some((l) => l.includes('fetched 1 file(s)') && l.includes('reused 1'))).toBe(true);
    expect(readdirSync(join(root, 'views')).length).toBe(2);
  });

  test.each([
    ['../evil', 'parent-escape'],
    ['/etc/evil', 'absolute'],
    ['a/b', 'separator'],
    ['.', 'dot'],
    ['..', 'dotdot'],
    ['', 'empty'],
  ])('M5 dirName 不安全 %s → 整清单拒绝抛 TeamSkillsError + 零写入', async (dirName) => {
    const root = cacheRoot('m5');
    const sentinel = join(root, '..', 'sentinel-escape');
    const fetcher = fetcherFrom(demoContents('x'));
    await expect(
      materializeTeamSkills({
        cacheRoot: root,
        manifest: manifest([{ ...demoSkill('x'), dirName }]),
        fetchFile: fetcher.fetchFile,
      }),
    ).rejects.toThrow(TeamSkillsError);
    expect(fetcher.calls).toEqual([]);
    expect(existsSync(sentinel)).toBe(false);
    if (existsSync(root)) {
      expect(readdirSync(root)).toEqual([]);
    }
  });

  test.each([
    ['../escape.txt', 'parent-escape'],
    ['/etc/passwd', 'absolute'],
    ['a//b.md', 'empty-segment'],
    ['./SKILL.md', 'dot-segment'],
    ['..\\SKILL.md', 'backslash-escape'],
  ])('M6 file path 不安全 %s → 整清单拒绝抛 TeamSkillsError', async (path) => {
    const root = cacheRoot('m6');
    await expect(
      materializeTeamSkills({
        cacheRoot: root,
        manifest: manifest([
          { ...demoSkill('x'), files: [{ path, sizeBytes: 1, sha256: sha256(Buffer.from('x')) }] },
        ]),
        fetchFile: fetcherFrom({}).fetchFile,
      }),
    ).rejects.toThrow(TeamSkillsError);
  });

  test('M7 atomic writes: no .tmp- residue in views/ blobs/ after success', async () => {
    const root = cacheRoot('m7');
    await materializeTeamSkills({
      cacheRoot: root,
      manifest: manifest([demoSkill('v1')]),
      fetchFile: fetcherFrom(demoContents('v1')).fetchFile,
    });
    expect(readdirSync(join(root, 'views')).filter((e) => e.includes('.tmp-'))).toEqual([]);
    expect(readdirSync(join(root, 'blobs')).filter((e) => e.includes('.tmp-'))).toEqual([]);
  });

  test('M8 views pruning: over maxEntries → keep only the newest, oldest deleted', async () => {
    const root = cacheRoot('m8');
    const max = 3;
    const dirs: string[] = [];
    for (let i = 0; i < max + 2; i++) {
      const entry = `content ${i}\n`;
      const d = await materializeTeamSkills({
        cacheRoot: root,
        manifest: manifest([
          {
            id: `s${i}`,
            name: `s${i}`,
            description: null,
            dirName: `s${i}`,
            files: [fileEntry('SKILL.md', entry)],
          },
        ]),
        fetchFile: fetcherFrom({ [`s${i}/SKILL.md`]: entry }).fetchFile,
        maxEntries: max,
      });
      dirs.push(d!);
      const t = new Date(Date.now() - (max + 2 - i) * 10_000);
      utimesSync(d!, t, t);
    }
    const left = readdirSync(join(root, 'views'));
    expect(left.length).toBeLessThanOrEqual(max);
    expect(existsSync(dirs[dirs.length - 1]!)).toBe(true);
    expect(existsSync(dirs[0]!)).toBe(false);
  });

  test("M9 default cap is the constant's value; cache hit touches the view mtime (LRU treats it as newest)", async () => {
    expect(TEAM_SKILLS_CACHE_MAX_ENTRIES).toBeGreaterThan(0);
    expect(TEAM_SKILLS_BLOB_MAX_ENTRIES).toBeGreaterThan(TEAM_SKILLS_CACHE_MAX_ENTRIES);
    const root = cacheRoot('m9');
    const m = manifest([demoSkill('v1')]);
    const dir = (await materializeTeamSkills({
      cacheRoot: root,
      manifest: m,
      fetchFile: fetcherFrom(demoContents('v1')).fetchFile,
    }))!;
    const old = new Date(Date.now() - 60_000);
    utimesSync(dir, old, old);
    await materializeTeamSkills({
      cacheRoot: root,
      manifest: m,
      fetchFile: fetcherFrom({}).fetchFile,
    });
    expect(statSync(dir).mtime.getTime()).toBeGreaterThan(old.getTime() + 30_000);
  });

  test('M10 sha256 mismatch → TeamSkillsError names the file, view not written', async () => {
    const root = cacheRoot('m10');
    const m = manifest([demoSkill('v1')]);
    const dir = await materializeTeamSkills({
      cacheRoot: root,
      manifest: m,
      fetchFile: async (dirName, path) => {
        const good = Buffer.from(demoContents('v1')[`${dirName}/${path}`]!, 'utf8');
        if (path.endsWith('SKILL.md')) good[0] = good[0]! ^ 0xff;
        return good;
      },
    }).catch((err: unknown) => err);
    expect(dir).toBeInstanceOf(TeamSkillsError);
    expect((dir as Error).message).toContain('sha256 mismatch');
    expect((dir as Error).message).toContain('deploy-demo/SKILL.md');
    expect(readdirSync(join(root, 'views'))).toEqual([]);
  });

  test('M11 sizeBytes mismatch → TeamSkillsError names the file', async () => {
    const root = cacheRoot('m11');
    const skill = demoSkill('v1');
    const m = manifest([
      {
        ...skill,
        files: [{ ...skill.files[0]!, sizeBytes: skill.files[0]!.sizeBytes + 1 }, skill.files[1]!],
      },
    ]);
    await expect(
      materializeTeamSkills({
        cacheRoot: root,
        manifest: m,
        fetchFile: fetcherFrom(demoContents('v1')).fetchFile,
      }),
    ).rejects.toThrow(/size mismatch for deploy-demo\/SKILL\.md/);
  });

  test('M12 fetchFile throws (network/4xx same shape) → TeamSkillsError rethrown with root cause, view not written', async () => {
    const root = cacheRoot('m12');
    const err = await materializeTeamSkills({
      cacheRoot: root,
      manifest: manifest([demoSkill('v1')]),
      fetchFile: async () => {
        throw new Error('machine api 503: upstream gone');
      },
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TeamSkillsError);
    expect((err as Error).message).toContain('machine api 503');
    expect(readdirSync(join(root, 'views')).filter((e) => !e.startsWith('.tmp-'))).toEqual([]);
    expect(readdirSync(join(root, 'views')).filter((e) => e.includes('.tmp-'))).toEqual([]);
  });

  test('M13 binary content on disk byte for byte (no corruption for non-utf8)', async () => {
    const root = cacheRoot('m13');
    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0xd0, 0xa5]);
    const skill: MachineSkillsManifestResponse['skills'][number] = {
      id: 'bin',
      name: 'bin',
      description: null,
      dirName: 'bin',
      files: [fileEntry('assets/logo.png', binary), fileEntry('SKILL.md', '# bin\n')],
    };
    const dir = await materializeTeamSkills({
      cacheRoot: root,
      manifest: manifest([skill]),
      fetchFile: fetcherFrom({ 'bin/assets/logo.png': binary, 'bin/SKILL.md': '# bin\n' })
        .fetchFile,
    });
    expect(readFileSync(join(dir!, 'bin', 'assets', 'logo.png'))).toEqual(binary);
  });

  test('M14 blob missing + view missing → only missing files re-fetched, blob hits transferred zero bytes', async () => {
    const root = cacheRoot('m14');
    const m = manifest([demoSkill('v1')]);
    const dirA = await materializeTeamSkills({
      cacheRoot: root,
      manifest: m,
      fetchFile: fetcherFrom(demoContents('v1')).fetchFile,
    });
    const runbookEntry = demoSkill('v1').files[1]!;
    rmSync(join(root, 'blobs', runbookEntry.sha256), { force: true });
    rmSync(dirA!, { recursive: true, force: true });
    const second = fetcherFrom(demoContents('v1'));
    const dirB = await materializeTeamSkills({
      cacheRoot: root,
      manifest: m,
      fetchFile: second.fetchFile,
    });
    expect(second.calls).toEqual(['deploy-demo/refs/runbook.md']);
    expect(readFileSync(join(dirB!, 'deploy-demo', 'SKILL.md'), 'utf8')).toContain('v1');
  });

  test('M15 legacy-shape residue (content-addressed directories at the cacheRoot top level) reclaimed by prune', async () => {
    const root = cacheRoot('m15');
    mkdirSync(join(root, 'legacydigest0000'), { recursive: true });
    writeFileSync(join(root, 'legacydigest0000', 'SKILL.md'), 'old layout');
    mkdirSync(join(root, '.tmp-legacy'), { recursive: true });
    await materializeTeamSkills({
      cacheRoot: root,
      manifest: manifest([demoSkill('v1')]),
      fetchFile: fetcherFrom(demoContents('v1')).fetchFile,
    });
    expect(readdirSync(root).sort()).toEqual(['blobs', 'views']);
  });

  test('M16 blobs pruning: over maxBlobEntries → keep only the newest', async () => {
    const root = cacheRoot('m16');
    const dirs: string[] = [];
    for (let i = 0; i < 3; i++) {
      const skill: MachineSkillsManifestResponse['skills'][number] = {
        id: `s${i}`,
        name: `s${i}`,
        description: null,
        dirName: `s${i}`,
        files: [fileEntry('SKILL.md', `content ${i}\n`)],
      };
      const d = await materializeTeamSkills({
        cacheRoot: root,
        manifest: manifest([skill]),
        fetchFile: fetcherFrom({ [`s${i}/SKILL.md`]: `content ${i}\n` }).fetchFile,
        maxBlobEntries: 2,
      });
      dirs.push(d!);
      const age = new Date(Date.now() - (3 - i) * 10_000);
      for (const b of readdirSync(join(root, 'blobs'))) {
        utimesSync(join(root, 'blobs', b), age, age);
      }
    }
    expect(readdirSync(join(root, 'blobs')).length).toBeLessThanOrEqual(2);
    for (let i = 0; i < 3; i++) {
      expect(readFileSync(join(dirs[i]!, `s${i}`, 'SKILL.md'), 'utf8')).toBe(`content ${i}\n`);
    }
  });
});
