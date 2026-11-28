import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { MachineSkillsManifestResponse } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import {
  holdTeamSkillsCache,
  materializeTeamSkills,
  purgeTeamSkillsCopies,
  releaseTeamSkillsCache,
} from '../src/team-skills.js';
import { testTempDir } from './test-temp-dir.js';

function cacheRoot(tag: string): string {
  return join(testTempDir(`cairn-team-skills-purge-${tag}-`), 'team-skills');
}

function putSkill(dir: string, dirName: string, body = '步骤…\n'): void {
  mkdirSync(join(dir, dirName), { recursive: true });
  writeFileSync(join(dir, dirName, 'SKILL.md'), `---\nname: ${dirName}\n---\n${body}`);
}

function skillEntry(
  dirName: string,
  content: string,
): MachineSkillsManifestResponse['skills'][number] {
  return {
    id: dirName,
    name: dirName,
    description: null,
    dirName,
    files: [
      {
        path: 'SKILL.md',
        sizeBytes: Buffer.byteLength(content),
        sha256: createHash('sha256').update(content).digest('hex'),
      },
    ],
  };
}

describe('purgeTeamSkillsCopies', () => {
  test('P1: views and plugins that carry skills the manifest no longer lists leave whole, and the view matching the manifest stays', () => {
    const root = cacheRoot('p1');
    const viewCurrent = join(root, 'views', 'current');
    const viewOld = join(root, 'views', 'old');
    const viewOnlyDeleted = join(root, 'views', 'only-deleted');
    putSkill(viewCurrent, 'other');
    putSkill(viewOld, 'deploy');
    putSkill(viewOld, 'other');
    putSkill(viewOnlyDeleted, 'deploy');
    const pluginMixed = join(root, 'plugins', 'mixed');
    putSkill(join(pluginMixed, 'skills'), 'deploy');
    putSkill(join(pluginMixed, 'skills'), 'other');
    const pluginOnlyDeleted = join(root, 'plugins', 'only-deleted');
    putSkill(join(pluginOnlyDeleted, 'skills'), 'deploy');

    const result = purgeTeamSkillsCopies({
      cacheRoot: root,
      dirNames: ['other'],
      keepView: viewCurrent,
    });

    expect(result.removed).toBe(6);
    expect(existsSync(join(viewCurrent, 'other'))).toBe(true);
    expect(existsSync(viewOld)).toBe(false);
    expect(existsSync(viewOnlyDeleted)).toBe(false);
    expect(existsSync(pluginMixed)).toBe(false);
    expect(existsSync(pluginOnlyDeleted)).toBe(false);
    expect(readdirSync(join(root, 'views'))).toEqual(['current']);
    expect(readdirSync(join(root, 'plugins'))).toEqual([]);
  });

  test('P2: a stale view leaves whole, never edited in place, so a restored manifest cannot hit a half cache', () => {
    const root = cacheRoot('p2');
    const stale = join(root, 'views', 'stale');
    putSkill(stale, 'deploy');
    putSkill(stale, 'other');
    purgeTeamSkillsCopies({
      cacheRoot: root,
      dirNames: ['other'],
    });
    expect(existsSync(stale)).toBe(false);
  });

  test('P3: a view with the same skill set and older content is left for the LRU', () => {
    const root = cacheRoot('p3');
    const older = join(root, 'views', 'older-content');
    putSkill(older, 'other', 'an older revision\n');
    const result = purgeTeamSkillsCopies({
      cacheRoot: root,
      dirNames: ['other'],
    });
    expect(result.removed).toBe(0);
    expect(existsSync(join(older, 'other', 'SKILL.md'))).toBe(true);
  });

  test('P4: a view and plugin that carry only names the complete manifest still lists stay: a narrower cache is not a deletion', () => {
    const root = cacheRoot('p4');
    const view = join(root, 'views', 'live-view');
    putSkill(view, 'other');
    const plugin = join(root, 'plugins', 'subset');
    putSkill(join(plugin, 'skills'), 'other');
    mkdirSync(join(plugin, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(plugin, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'cairn-team-skills', sourceView: 'live-view' }),
    );
    const result = purgeTeamSkillsCopies({
      cacheRoot: root,
      dirNames: ['other', 'both'],
    });
    expect(result.removed).toBe(0);
    expect(existsSync(join(view, 'other', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(plugin, 'skills', 'other', 'SKILL.md'))).toBe(true);
  });

  test('P5: a plugin holding a name the manifest no longer carries is removed once its view is gone', () => {
    const root = cacheRoot('p5');
    const plugin = join(root, 'plugins', 'stale');
    putSkill(join(plugin, 'skills'), 'deploy');
    putSkill(join(plugin, 'skills'), 'other');
    mkdirSync(join(plugin, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(plugin, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'cairn-team-skills', sourceView: 'gone-view' }),
    );
    const result = purgeTeamSkillsCopies({
      cacheRoot: root,
      dirNames: ['other'],
    });
    expect(result.removed).toBe(2);
    expect(existsSync(plugin)).toBe(false);
  });

  test('P6: a view a running step still holds is left alone until that step finishes', () => {
    const root = cacheRoot('p6');
    const running = join(root, 'views', 'running');
    putSkill(running, 'deploy');
    putSkill(running, 'other');
    const release = holdTeamSkillsCache([running]);
    expect(purgeTeamSkillsCopies({ cacheRoot: root, dirNames: ['other'] })).toEqual({ removed: 0 });
    expect(existsSync(join(running, 'deploy'))).toBe(true);
    release();
    expect(purgeTeamSkillsCopies({ cacheRoot: root, dirNames: ['other'] })).toEqual({ removed: 2 });
    expect(existsSync(running)).toBe(false);
  });

  test('P7: nothing is removed when the cache is not there yet', () => {
    const root = cacheRoot('p4');
    const result = purgeTeamSkillsCopies({ cacheRoot: root, dirNames: [] });
    expect(result.removed).toBe(0);
    expect(existsSync(root)).toBe(false);
  });

  test('P8: an empty complete manifest removes every cached view and plugin', () => {
    const root = cacheRoot('p5');
    const view = join(root, 'views', 'any');
    putSkill(view, 'deploy');
    const plugin = join(root, 'plugins', 'any');
    putSkill(join(plugin, 'skills'), 'deploy');
    const result = purgeTeamSkillsCopies({
      cacheRoot: root,
      dirNames: [],
    });
    expect(result.removed).toBe(2);
    expect(readdirSync(join(root, 'views'))).toEqual([]);
    expect(readdirSync(join(root, 'plugins'))).toEqual([]);
  });
});

describe('materializeTeamSkills purge wiring', () => {
  test('W1: materializing a complete manifest removes the copy of a skill the server no longer distributes', async () => {
    const root = cacheRoot('w1');
    const oldView = join(root, 'views', 'old');
    putSkill(oldView, 'deploy');
    putSkill(oldView, 'keep');
    const keepBody = '---\nname: keep\n---\nkeep body\n';
    const manifest: MachineSkillsManifestResponse = {
      selection: 'all',
      skills: [skillEntry('keep', keepBody)],
    };
    const view = await materializeTeamSkills({
      cacheRoot: root,
      manifest,
      fetchFile: async () => Buffer.from(keepBody, 'utf8'),
    });
    expect(view).not.toBeNull();
    expect(existsSync(join(view ?? '', 'keep', 'SKILL.md'))).toBe(true);
    expect(existsSync(oldView)).toBe(false);
  });

  test('W2: a whitelist manifest leaves other skills copies alone (a narrower selection is not a deletion)', async () => {
    const root = cacheRoot('w2');
    const oldView = join(root, 'views', 'old');
    putSkill(oldView, 'deploy');
    putSkill(oldView, 'keep');
    const keepBody = '---\nname: keep\n---\nkeep body\n';
    await materializeTeamSkills({
      cacheRoot: root,
      manifest: { selection: 'whitelist', skills: [skillEntry('keep', keepBody)] },
      fetchFile: async () => Buffer.from(keepBody, 'utf8'),
    });
    expect(existsSync(join(oldView, 'deploy'))).toBe(true);
    expect(existsSync(join(oldView, 'keep'))).toBe(true);
  });

  test('W3: a cache hit purges the stale views and leaves the hit view intact without refetching', async () => {
    const root = cacheRoot('w3');
    const keepBody = '---\nname: keep\n---\nkeep body\n';
    const manifest: MachineSkillsManifestResponse = {
      selection: 'all',
      skills: [skillEntry('keep', keepBody)],
    };
    const first = await materializeTeamSkills({
      cacheRoot: root,
      manifest,
      fetchFile: async () => Buffer.from(keepBody, 'utf8'),
    });
    const stale = join(root, 'views', 'stale');
    putSkill(stale, 'deploy');
    const hit = await materializeTeamSkills({
      cacheRoot: root,
      manifest,
      fetchFile: async () => {
        throw new Error('a cache hit must not refetch files');
      },
    });
    expect(hit).toBe(first);
    expect(existsSync(join(hit ?? '', 'keep', 'SKILL.md'))).toBe(true);
    expect(existsSync(stale)).toBe(false);
  });

  test('W5: the view a materialize just returned is held before it returns, so a purge from another step cannot take it', async () => {
    const root = cacheRoot('w5');
    const keepBody = '---\nname: keep\n---\nkeep body\n';
    const view = await materializeTeamSkills({
      cacheRoot: root,
      manifest: { selection: 'all', skills: [skillEntry('keep', keepBody)] },
      fetchFile: async () => Buffer.from(keepBody, 'utf8'),
    });
    expect(view).not.toBeNull();
    expect(purgeTeamSkillsCopies({ cacheRoot: root, dirNames: [] }).removed).toBe(0);
    expect(existsSync(join(view ?? '', 'keep', 'SKILL.md'))).toBe(true);
    releaseTeamSkillsCache(view ?? '');
    expect(purgeTeamSkillsCopies({ cacheRoot: root, dirNames: [] }).removed).toBe(1);
    expect(existsSync(view ?? '')).toBe(false);
  });

  test('W4: an empty complete manifest returns no view and removes every cached copy', async () => {
    const root = cacheRoot('w4');
    const view = join(root, 'views', 'any');
    putSkill(view, 'deploy');
    const plugin = join(root, 'plugins', 'any');
    putSkill(join(plugin, 'skills'), 'deploy');
    const result = await materializeTeamSkills({
      cacheRoot: root,
      manifest: { selection: 'all', skills: [] },
      fetchFile: async () => Buffer.from('never', 'utf8'),
    });
    expect(result).toBeNull();
    expect(readdirSync(join(root, 'views'))).toEqual([]);
    expect(readdirSync(join(root, 'plugins'))).toEqual([]);
  });
});
