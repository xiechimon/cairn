import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSkillFrontmatter, skillRecordSchema } from '@cairn/shared';
import { afterAll, describe, expect, test } from 'vitest';
import { composeChiefSystemPrompt } from '../src/services/chief.js';
import { type ChiefToolCtx, executeChiefTool } from '../src/services/chief-tools.js';
import { executeMcpTool } from '../src/services/mcp-face.js';
import { scanLocalSkills } from '../src/services/skills.js';
import { bootServer, insertMachine, req, type TestServer } from './helpers.js';

const roots: string[] = [];
function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'cairn-skills-'));
  roots.push(root);
  return root;
}
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function addSkill(
  root: string,
  dirName: string,
  frontmatter: string | { name?: string; description?: string } | null = null,
): string {
  const dir = join(root, dirName);
  mkdirSync(dir, { recursive: true });
  const fm =
    frontmatter === null
      ? ''
      : typeof frontmatter === 'string'
        ? frontmatter
        : `---\n${Object.entries(frontmatter)
            .map(([k, v]) => `${k}: ${v}`)
            .join('\n')}\n---\n`;
  writeFileSync(join(dir, 'SKILL.md'), `${fm}# ${dirName}\n步骤…\n`);
  return dir;
}

describe('the scanLocalSkills directory scan', () => {
  test('S1/S2/S3: missing directory, path is a file, empty directory = an empty set, no crash', () => {
    const root = makeRoot();
    expect(scanLocalSkills(join(root, 'nope'))).toEqual([]);
    const filePath = join(root, 'a-file');
    writeFileSync(filePath, 'x');
    expect(scanLocalSkills(filePath)).toEqual([]);
    const empty = join(root, 'empty');
    mkdirSync(empty);
    expect(scanLocalSkills(empty)).toEqual([]);
  });

  test('S4: subdirectories without SKILL.md are not listed; lowercase skill.md is not recognized', () => {
    const root = makeRoot();
    mkdirSync(join(root, 'bare'));
    writeFileSync(join(root, 'bare', 'README.md'), '# x');
    mkdirSync(join(root, 'lower'));
    writeFileSync(join(root, 'lower', 'skill.md'), '---\nname: lower\n---\n');
    writeFileSync(join(root, 'SKILL.md'), '---\nname: root-level\n---\n');
    expect(scanLocalSkills(root)).toEqual([]);
  });

  test('S5: nested skills are not discovered -- only first-level subdirectories are scanned', () => {
    const root = makeRoot();
    mkdirSync(join(root, 'outer', 'inner'), { recursive: true });
    writeFileSync(join(root, 'outer', 'inner', 'SKILL.md'), '---\nname: inner\n---\n');
    expect(scanLocalSkills(root)).toEqual([]);
    writeFileSync(join(root, 'outer', 'SKILL.md'), '---\nname: outer\n---\n');
    expect(scanLocalSkills(root).map((s) => s.id)).toEqual(['outer']);
  });

  test('S6/S7/S9: frontmatter wins; without frontmatter falls back to the directory name; id = frontmatter.name (contract revision)', () => {
    const root = makeRoot();
    addSkill(root, 'deploy', { name: 'deployer', description: '部署流程手册' });
    addSkill(root, 'plain', null);
    const scanned = scanLocalSkills(root);
    expect(scanned).toEqual([
      { id: 'deployer', name: 'deployer', description: '部署流程手册', dirName: 'deploy' },
      { id: 'plain', name: 'plain', description: null, dirName: 'plain' },
    ]);
  });

  test('S8: folded-block scalar markers are not accepted -- name/description fall back (a shape measured against the real anthropics/skills repo)', () => {
    const root = makeRoot();
    addSkill(
      root,
      'folded',
      '---\nname: academy-guide\ndescription: >\n  A folded multi-line\n  description here.\n---\n',
    );
    addSkill(root, 'folded-name', '---\nname: |-\n  block\n---\n');
    const scanned = scanLocalSkills(root);
    expect(scanned).toEqual([
      { id: 'academy-guide', name: 'academy-guide', description: null, dirName: 'folded' },
      { id: 'folded-name', name: 'folded-name', description: null, dirName: 'folded-name' },
    ]);
    expect(parseSkillFrontmatter('---\nname: a\ndescription: b\n---\n')).toEqual({
      name: 'a',
      description: 'b',
    });
    expect(parseSkillFrontmatter('no frontmatter')).toEqual({});
    expect(parseSkillFrontmatter('---\nname: "quoted"\n---\n')).toEqual({ name: 'quoted' });
  });

  test('S10: two directories with the same frontmatter name = the earlier one in directory-name order wins (deterministic)', () => {
    const root = makeRoot();
    addSkill(root, 'zzz', { name: 'dup' });
    addSkill(root, 'aaa', { name: 'dup', description: 'aaa 的' });
    const scanned = scanLocalSkills(root);
    expect(scanned).toHaveLength(1);
    expect(scanned[0]).toMatchObject({ id: 'dup', dirName: 'aaa' });
  });

  test('S11: symlinked directories are listed; realpath dedupe counts one', () => {
    const root = makeRoot();
    const real = addSkill(root, 'real', { name: 'linked-skill' });
    symlinkSync(real, join(root, 'alias'));
    expect(scanLocalSkills(root)).toEqual([
      { id: 'linked-skill', name: 'linked-skill', description: null, dirName: 'alias' },
    ]);
    const outside = makeRoot();
    const outsideDir = addSkill(outside, 'outside-skill', { name: 'outside' });
    symlinkSync(outsideDir, join(root, 'external'));
    expect(
      scanLocalSkills(root)
        .map((s) => s.id)
        .sort(),
    ).toEqual(['linked-skill', 'outside']);
  });

  test('S12: an unreadable SKILL.md (a directory / vanishing midway) = skipped, no crash', () => {
    const root = makeRoot();
    mkdirSync(join(root, 'weird', 'SKILL.md'), { recursive: true });
    addSkill(root, 'ok', { name: 'ok' });
    expect(scanLocalSkills(root).map((s) => s.id)).toEqual(['ok']);
  });
});

describe('the skills REST surface (rescanned source)', () => {
  function setup() {
    const skillsDir = makeRoot();
    const s = bootServer({ skillsDir });
    return { s, skillsDir };
  }

  test('R1/R3/R4: GET /api/skills = the rescanned record array; no cache, an added directory is visible immediately; an empty directory = []', async () => {
    const { s, skillsDir } = setup();
    try {
      const empty = await req(s.app, 'GET', `/api/skills?teamId=${s.team.id}`);
      expect(empty.status).toBe(200);
      expect(await empty.json()).toEqual([]);
      addSkill(skillsDir, 'deploy', { name: 'deploy', description: '部署流程' });
      const res = await req(s.app, 'GET', `/api/skills?teamId=${s.team.id}`);
      const rows = (await res.json()) as unknown[];
      expect(rows).toHaveLength(1);
      const record = skillRecordSchema.parse(rows[0]);
      expect(record).toEqual({
        id: 'deploy',
        teamId: s.team.id,
        name: 'deploy',
        description: '部署流程',
      });
      addSkill(skillsDir, 'review', { name: 'review' });
      const again = (await (await req(s.app, 'GET', `/api/skills?teamId=${s.team.id}`)).json()) as {
        id: string;
      }[];
      expect(again.map((r) => r.id)).toEqual(['deploy', 'review']);
    } finally {
      s.dispose();
    }
  });

  test('R2: an unknown team = 404 {error}', async () => {
    const { s } = setup();
    try {
      const res = await req(s.app, 'GET', '/api/skills?teamId=nope');
      expect(res.status).toBe(404);
      expect(Object.keys((await res.json()) as object)).toEqual(['error']);
    } finally {
      s.dispose();
    }
  });

  test('R5/R6: the POST /api/skills write surface is back (the old shape = the 400 validation gate); scan is still deleted = 404', async () => {
    const { s } = setup();
    try {
      const upload = await req(s.app, 'POST', '/api/skills', {
        name: 'x',
        files: { 'SKILL.md': '# x' },
      });
      expect(upload.status).toBe(400);
      const scan = await req(s.app, 'POST', '/api/skills/scan', { repo: 'owner/repo' });
      expect(scan.status).toBe(404);
    } finally {
      s.dispose();
    }
  });

  test('R7/R8: detail = record + fileNames (nested relative paths); file = the content, defaulting to SKILL.md', async () => {
    const { s, skillsDir } = setup();
    try {
      const dir = addSkill(skillsDir, 'deploy', { name: 'deployer', description: '部署' });
      mkdirSync(join(dir, 'scripts'));
      writeFileSync(join(dir, 'scripts', 'run.sh'), 'echo hi');
      writeFileSync(join(dir, 'helper.sh'), 'echo helper');

      const one = await req(s.app, 'GET', `/api/teams/${s.team.id}/skills/deployer`);
      expect(one.status).toBe(200);
      const detail = (await one.json()) as Record<string, unknown>;
      expect(skillRecordSchema.safeParse(detail).success).toBe(true);
      expect((detail.fileNames as string[]).sort()).toEqual([
        'SKILL.md',
        'helper.sh',
        'scripts/run.sh',
      ]);

      const file = await req(
        s.app,
        'GET',
        `/api/teams/${s.team.id}/skills/deployer/file?fileName=scripts/run.sh`,
      );
      expect(await file.json()).toEqual({ fileName: 'scripts/run.sh', content: 'echo hi' });
      const entry = await req(s.app, 'GET', `/api/teams/${s.team.id}/skills/deployer/file`);
      const entryBody = (await entry.json()) as { fileName: string; content: string };
      expect(entryBody.fileName).toBe('SKILL.md');
      expect(entryBody.content).toContain('# deploy');
    } finally {
      s.dispose();
    }
  });

  test('R9/R10/R11: an unknown sid, an unknown file, a path escape are all 404 (no existence leak, no leaving the directory)', async () => {
    const { s, skillsDir } = setup();
    try {
      addSkill(skillsDir, 'deploy', { name: 'deploy' });
      const base = `/api/teams/${s.team.id}/skills`;
      expect((await req(s.app, 'GET', `${base}/nope`)).status).toBe(404);
      expect((await req(s.app, 'GET', `${base}/deploy/file?fileName=nope.md`)).status).toBe(404);
      expect((await req(s.app, 'GET', `${base}/..%2F..%2Fetc`)).status).toBe(404);
      expect((await req(s.app, 'GET', `${base}/....`)).status).toBe(404);
      const escaped = await req(
        s.app,
        'GET',
        `${base}/deploy/file?fileName=..%2F..%2F..%2Fetc%2Fpasswd`,
      );
      expect(escaped.status).toBe(404);
      const absolute = await req(s.app, 'GET', `${base}/deploy/file?fileName=%2Fetc%2Fpasswd`);
      expect(absolute.status).toBe(404);
    } finally {
      s.dispose();
    }
  });

  test('R12: an oversized file (>512KB) = 400 naming the cap', async () => {
    const { s, skillsDir } = setup();
    try {
      const dir = addSkill(skillsDir, 'big', { name: 'big' });
      writeFileSync(join(dir, 'blob.bin'), Buffer.alloc(600_000, 1));
      const res = await req(
        s.app,
        'GET',
        `/api/teams/${s.team.id}/skills/big/file?fileName=blob.bin`,
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain('512000');
    } finally {
      s.dispose();
    }
  });

  test('R13: a file-level symlink pointing outside the skills directory = 404 (link escape, the same rule as the listing surface)', async () => {
    const { s, skillsDir } = setup();
    const outside = makeRoot();
    try {
      const dir = addSkill(skillsDir, 'linked', { name: 'linked' });
      const secret = join(outside, 'secret.txt');
      writeFileSync(secret, '目录外内容');
      symlinkSync(secret, join(dir, 'leak.txt'));
      symlinkSync(join(dir, 'SKILL.md'), join(dir, 'inner-link.md'));
      const base = `/api/teams/${s.team.id}/skills/linked/file`;
      const leak = await req(s.app, 'GET', `${base}?fileName=leak.txt`);
      expect(leak.status).toBe(404);
      const detail = (await (
        await req(s.app, 'GET', `/api/teams/${s.team.id}/skills/linked`)
      ).json()) as { fileNames: string[] };
      expect(detail.fileNames).not.toContain('leak.txt');
      const inner = await req(s.app, 'GET', `${base}?fileName=inner-link.md`);
      expect(inner.status).toBe(200);
    } finally {
      s.dispose();
    }
  });
});

describe('agent.skillsAllowlist / defaultSkill validation against the live scan (#1169 field split)', () => {
  function setup() {
    const skillsDir = makeRoot();
    addSkill(skillsDir, 'deploy', { name: 'deploy' });
    addSkill(skillsDir, 'review', { name: 'review' });
    const s = bootServer({ skillsDir });
    return { s, skillsDir };
  }

  async function createAgent(
    s: TestServer,
    body: Record<string, unknown>,
  ): Promise<{ id: string; row: Record<string, unknown> }> {
    const res = await req(s.app, 'POST', `/api/teams/${s.team.id}/agents`, {
      displayName: 'a1',
      machineId: insertMachine(s),
      ...body,
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const got = await req(s.app, `GET`, `/api/teams/${s.team.id}/agents/${id}`);
    const row = (await got.json()) as Record<string, unknown>;
    return { id, row };
  }

  test('A1: POST skillsAllowlist carrying an unknown id = silently filtered; absent = null (unrestricted, no longer [])', async () => {
    const { s } = setup();
    try {
      expect((await createAgent(s, { skillsAllowlist: ['deploy', 'ghost'] })).row).toMatchObject({
        skillsAllowlist: ['deploy'],
        defaultSkill: null,
      });
      expect((await createAgent(s, {})).row).toMatchObject({
        skillsAllowlist: null,
        defaultSkill: null,
      });
    } finally {
      s.dispose();
    }
  });

  test('A2: PATCH with null = explicitly cleared to unrestricted; without the field = the list unchanged (undefined and null must not collapse)', async () => {
    const { s } = setup();
    try {
      const { id, row } = await createAgent(s, { skillsAllowlist: ['deploy'] });
      expect(row).toMatchObject({ skillsAllowlist: ['deploy'] });
      const cleared = await req(s.app, 'PATCH', `/api/teams/${s.team.id}/agents/${id}`, {
        skillsAllowlist: null,
      });
      expect(cleared.status).toBe(200);
      expect(((await cleared.json()) as Record<string, unknown>).skillsAllowlist).toBeNull();
      const untouched = await req(s.app, 'PATCH', `/api/teams/${s.team.id}/agents/${id}`, {
        displayName: 'renamed',
      });
      expect(((await untouched.json()) as Record<string, unknown>).skillsAllowlist).toBeNull();
      const restricted = await req(s.app, 'PATCH', `/api/teams/${s.team.id}/agents/${id}`, {
        skillsAllowlist: ['review'],
      });
      expect(((await restricted.json()) as Record<string, unknown>).skillsAllowlist).toEqual([
        'review',
      ]);
    } finally {
      s.dispose();
    }
  });

  test('A3: defaultSkill is a single-value slot -- string/null pass, arrays (single-element included) are rejected; an unknown id filters to null', async () => {
    const { s } = setup();
    try {
      const set = await createAgent(s, { defaultSkill: 'deploy' });
      expect(set.row).toMatchObject({ defaultSkill: 'deploy', skillsAllowlist: null });
      const unknown = await createAgent(s, { defaultSkill: 'ghost' });
      expect(unknown.row).toMatchObject({ defaultSkill: null });
      const cleared = await req(s.app, 'PATCH', `/api/teams/${s.team.id}/agents/${unknown.id}`, {
        defaultSkill: 'review',
      });
      expect(((await cleared.json()) as Record<string, unknown>).defaultSkill).toBe('review');
      const nullBack = await req(s.app, 'PATCH', `/api/teams/${s.team.id}/agents/${unknown.id}`, {
        defaultSkill: null,
      });
      expect(((await nullBack.json()) as Record<string, unknown>).defaultSkill).toBeNull();
      const arr = await req(s.app, 'POST', `/api/teams/${s.team.id}/agents`, {
        displayName: 'arr',
        machineId: insertMachine(s),
        defaultSkill: ['deploy'],
      });
      expect(arr.status).toBe(400);
    } finally {
      s.dispose();
    }
  });

  test('A4: zero regression on a non-empty allowlist -- the selected subset passes as is (the filter only eats unknown ids, no reordering, no drops)', async () => {
    const { s, skillsDir } = setup();
    try {
      const { id } = await createAgent(s, { skillsAllowlist: ['review', 'deploy'] });
      rmSync(join(skillsDir, 'deploy'), { recursive: true, force: true });
      const patched = await req(s.app, 'PATCH', `/api/teams/${s.team.id}/agents/${id}`, {
        skillsAllowlist: ['deploy', 'review', 'ghost'],
      });
      expect(((await patched.json()) as Record<string, unknown>).skillsAllowlist).toEqual([
        'review',
      ]);
    } finally {
      s.dispose();
    }
  });
});

describe('the chief tool surface (rescanned source + delete_skills struck from the vocabulary)', () => {
  function setup() {
    const skillsDir = makeRoot();
    addSkill(skillsDir, 'deploy', { name: 'deploy', description: '部署流程' });
    const s = bootServer({ skillsDir });
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
      skillsDir,
    };
    return { s, skillsDir, ctx, deps };
  }

  test('C1: relay skills = the rescan projection (id/name/description)', async () => {
    const { s, deps, ctx } = setup();
    try {
      const text = await executeChiefTool(deps, ctx, 'skills', {});
      expect(JSON.parse(text)).toEqual([{ id: 'deploy', name: 'deploy', description: '部署流程' }]);
    } finally {
      s.dispose();
    }
  });

  test('C2: relay delete_skills = 400 unknown chief tool (struck from the vocabulary)', async () => {
    const { s, deps, ctx } = setup();
    try {
      await expect(
        executeChiefTool(deps, ctx, 'delete_skills', { skillIds: ['deploy'] }),
      ).rejects.toThrowError(/unknown chief tool/);
    } finally {
      s.dispose();
    }
  });

  test('C3: the composeChiefSystemPrompt resource list contains the rescanned skills', () => {
    const { s, skillsDir } = setup();
    try {
      const prompt = composeChiefSystemPrompt(
        { db: s.db, hub: s.hub, machineHub: s.machineHub, user: s.user, skillsDir },
        s.team.id,
      );
      expect(prompt).toContain('skills:');
      expect(prompt).toContain('"id":"deploy"');
    } finally {
      s.dispose();
    }
  });
});

describe('the mcp-face skills tool (rescanned source)', () => {
  test('M1: executeMcpTool skills = the rescan projection', async () => {
    const skillsDir = makeRoot();
    addSkill(skillsDir, 'deploy', { name: 'deploy', description: '部署流程' });
    const s = bootServer({ skillsDir });
    try {
      const text = await executeMcpTool(
        {
          db: s.db,
          hub: s.hub,
          machineHub: s.machineHub,
          box: s.secretBox,
          user: s.user,
          reposDir: s.reposDir,
          attachmentsDir: s.attachmentsDir,
          skillsDir,
        },
        { teamId: s.team.id, user: s.user, grants: new Set(['Skills']) },
        'skills',
        {},
      );
      expect(JSON.parse(text)).toEqual([{ id: 'deploy', name: 'deploy', description: '部署流程' }]);
    } finally {
      s.dispose();
    }
  });
});

describe('the skills read-surface wire shape regression', () => {
  test('every GET /api/skills response row passes skillRecordSchema; file contents round-trip verbatim', async () => {
    const skillsDir = makeRoot();
    const dir = addSkill(skillsDir, 'roundtrip', { name: 'roundtrip' });
    writeFileSync(join(dir, 'note.txt'), '往返内容');
    const s = bootServer({ skillsDir });
    try {
      const list = (await (
        await req(s.app, 'GET', `/api/skills?teamId=${s.team.id}`)
      ).json()) as unknown[];
      for (const row of list) expect(skillRecordSchema.safeParse(row).success).toBe(true);
      const file = await req(
        s.app,
        'GET',
        `/api/teams/${s.team.id}/skills/roundtrip/file?fileName=note.txt`,
      );
      expect((await file.json()) as { content: string }).toEqual({
        fileName: 'note.txt',
        content: readFileSync(join(dir, 'note.txt'), 'utf8'),
      });
    } finally {
      s.dispose();
    }
  });
});
