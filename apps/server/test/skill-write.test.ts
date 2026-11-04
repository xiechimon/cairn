import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AGENT_TOOL_SKILL_CREATE,
  AGENT_TOOL_SKILL_UPDATE,
  type ClaimedStep,
  MAX_SKILL_FILE_BYTES,
  MAX_SKILL_TOTAL_BYTES,
  machineSkillsManifestResponseSchema,
  skillRecordSchema,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, describe, expect, test } from 'vitest';
import { agent as agentTable, skillAudit } from '../src/db/schema.js';
import { type ChiefToolCtx, executeChiefTool } from '../src/services/chief-tools.js';
import { bindAllAgents, bootServer, issueApiKey, postProject, req } from './helpers.js';

const roots: string[] = [];
function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'cairn-skills-'));
  roots.push(root);
  return root;
}
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function skillMd(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n步骤…\n`;
}

function createBody(
  name: string,
  description: string,
  extra: { path: string; content: string }[] = [],
): { name: string; description: string; files: { path: string; content: string }[] } {
  return {
    name,
    description,
    files: [{ path: 'SKILL.md', content: skillMd(name, description) }, ...extra],
  };
}

async function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return Promise.resolve(
    app.request(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
}

async function errorText(res: Response): Promise<string> {
  return ((await res.json()) as { error?: string }).error ?? '';
}

describe('the REST write surface (POST /api/skills + PUT teams/{id}/skills/{sid})', () => {
  test('C1: a normal create -> 201 record + written to disk + immediately visible on GET (no cache, rescanned)', async () => {
    const skillsDir = makeRoot();
    const s = bootServer({ skillsDir });
    try {
      const res = await req(
        s.app,
        'POST',
        '/api/skills',
        createBody('deploy', '部署流程', [{ path: 'scripts/run.sh', content: 'echo ok\n' }]),
      );
      expect(res.status).toBe(201);
      const record = skillRecordSchema.parse(await res.json());
      expect(record).toMatchObject({ id: 'deploy', name: 'deploy', description: '部署流程' });
      expect(readFileSync(join(skillsDir, 'deploy', 'SKILL.md'), 'utf8')).toBe(
        skillMd('deploy', '部署流程'),
      );
      expect(readFileSync(join(skillsDir, 'deploy', 'scripts/run.sh'), 'utf8')).toBe('echo ok\n');
      const list = (await (await req(s.app, 'GET', `/api/skills?teamId=${s.team.id}`)).json()) as {
        id: string;
      }[];
      expect(list.map((r) => r.id)).toEqual(['deploy']);
    } finally {
      s.dispose();
    }
  });

  test('V1: files without SKILL.md -> 400 naming it', async () => {
    const s = bootServer({ skillsDir: makeRoot() });
    try {
      const res = await req(s.app, 'POST', '/api/skills', {
        name: 'noskill',
        description: 'x',
        files: [{ path: 'README.md', content: 'no entry file' }],
      });
      expect(res.status).toBe(400);
      expect(await errorText(res)).toContain('SKILL.md');
    } finally {
      s.dispose();
    }
  });

  test('V2: frontmatter missing name / description -> 400 naming each', async () => {
    const s = bootServer({ skillsDir: makeRoot() });
    try {
      const noName = await req(s.app, 'POST', '/api/skills', {
        name: 'a',
        description: 'd',
        files: [{ path: 'SKILL.md', content: '---\ndescription: d\n---\nbody\n' }],
      });
      expect(noName.status).toBe(400);
      expect(await errorText(noName)).toContain('name');

      const noDesc = await req(s.app, 'POST', '/api/skills', {
        name: 'b',
        description: 'd',
        files: [{ path: 'SKILL.md', content: '---\nname: b\n---\nbody\n' }],
      });
      expect(noDesc.status).toBe(400);
      expect(await errorText(noDesc)).toContain('description');
    } finally {
      s.dispose();
    }
  });

  test('V3: the frontmatter and body declarations disagree -> 400 (frontmatter is the single source of truth)', async () => {
    const s = bootServer({ skillsDir: makeRoot() });
    try {
      const res = await req(s.app, 'POST', '/api/skills', {
        name: 'body-name',
        description: 'body desc',
        files: [{ path: 'SKILL.md', content: skillMd('fm-name', 'fm desc') }],
      });
      expect(res.status).toBe(400);
      const text = await errorText(res);
      expect(text).toContain('frontmatter');
      expect(text).toContain('fm-name');
    } finally {
      s.dispose();
    }
  });

  test('V4: an illegal directory name (.., subpath, backslash, -x, empty, over 64 characters) -> 400', async () => {
    const s = bootServer({ skillsDir: makeRoot() });
    try {
      for (const name of ['..', 'a/b', 'a\\b', '-x', '', 'x'.repeat(65)]) {
        const res = await req(s.app, 'POST', '/api/skills', {
          name,
          description: 'd',
          files: [{ path: 'SKILL.md', content: `---\nname: ${name}\ndescription: d\n---\n` }],
        });
        expect(res.status, JSON.stringify(name)).toBe(400);
        expect(await errorText(res)).toContain('name');
      }
    } finally {
      s.dispose();
    }
  });

  test('V5/V6: one file over 512k / the total over MAX_SKILL_TOTAL_BYTES -> 400 naming the cap', async () => {
    const s = bootServer({ skillsDir: makeRoot() });
    try {
      const big = 'x'.repeat(MAX_SKILL_FILE_BYTES + 1);
      const perFile = await req(
        s.app,
        'POST',
        '/api/skills',
        createBody('big', 'd', [{ path: 'big.txt', content: big }]),
      );
      expect(perFile.status).toBe(400);
      const perFileError = await errorText(perFile);
      expect(perFileError).toContain('big.txt');
      expect(perFileError).toContain(`${MAX_SKILL_FILE_BYTES}`);

      const total = await req(
        s.app,
        'POST',
        '/api/skills',
        createBody('fat', 'd', [
          { path: 'a.txt', content: 'x'.repeat(420_000) },
          { path: 'b.txt', content: 'x'.repeat(420_000) },
          { path: 'c.txt', content: 'x'.repeat(420_000) },
          { path: 'd.txt', content: 'x'.repeat(420_000) },
          { path: 'e.txt', content: 'x'.repeat(420_000) },
        ]),
      );
      expect(total.status).toBe(400);
      const totalError = await errorText(total);
      expect(totalError).toContain('total');
      expect(totalError).toContain(`${MAX_SKILL_TOTAL_BYTES}`);
    } finally {
      s.dispose();
    }
  });

  test('V7/V8: path escape and duplicate paths -> 400 (validate everything before writing, no half-written state)', async () => {
    const skillsDir = makeRoot();
    const s = bootServer({ skillsDir });
    try {
      for (const path of ['../escape.txt', './x.md', 'a//b.txt', 'a/../b.txt', '/abs.txt']) {
        const res = await req(
          s.app,
          'POST',
          '/api/skills',
          createBody('guard', 'd', [{ path, content: 'x' }]),
        );
        expect(res.status, JSON.stringify(path)).toBe(400);
        expect(await errorText(res)).toContain('path');
      }
      const dup = await req(
        s.app,
        'POST',
        '/api/skills',
        createBody('dup', 'd', [
          { path: 'a.txt', content: 'x' },
          { path: 'a.txt', content: 'y' },
        ]),
      );
      expect(dup.status).toBe(400);
      expect(await errorText(dup)).toContain('a.txt');
      expect(existsSync(join(skillsDir, 'dup'))).toBe(false);
    } finally {
      s.dispose();
    }
  });

  test('C2/C3: the directory is taken -> 409; the same id in another directory -> 409 naming the source directory', async () => {
    const skillsDir = makeRoot();
    mkdirSync(join(skillsDir, 'busy'));
    mkdirSync(join(skillsDir, 'other'));
    writeFileSync(join(skillsDir, 'other', 'SKILL.md'), skillMd('clash', '既有技能'));
    const s = bootServer({ skillsDir });
    try {
      const busy = await req(s.app, 'POST', '/api/skills', createBody('busy', 'd'));
      expect(busy.status).toBe(409);
      expect(await errorText(busy)).toContain('busy');

      const clash = await req(s.app, 'POST', '/api/skills', createBody('clash', 'd'));
      expect(clash.status).toBe(409);
      expect(await errorText(clash)).toContain('other');
    } finally {
      s.dispose();
    }
  });

  test('U1: PUT an unknown id -> 404', async () => {
    const s = bootServer({ skillsDir: makeRoot() });
    try {
      const res = await req(
        s.app,
        'PUT',
        `/api/teams/${s.team.id}/skills/ghost`,
        createBody('ghost', 'd'),
      );
      expect(res.status).toBe(404);
    } finally {
      s.dispose();
    }
  });

  test('U2: the update overwrite semantics -- listed files overwrite, unlisted files stay -> 200', async () => {
    const skillsDir = makeRoot();
    const dir = join(skillsDir, 'pkg');
    mkdirSync(dir);
    writeFileSync(join(dir, 'SKILL.md'), skillMd('pkg', '旧描述'));
    writeFileSync(join(dir, 'note.txt'), '旧笔记');
    const s = bootServer({ skillsDir });
    try {
      const res = await req(
        s.app,
        'PUT',
        `/api/teams/${s.team.id}/skills/pkg`,
        createBody('pkg', '新描述', [{ path: 'extra.md', content: '新增\n' }]),
      );
      expect(res.status).toBe(200);
      expect(skillRecordSchema.parse(await res.json())).toMatchObject({
        id: 'pkg',
        description: '新描述',
      });
      expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe(skillMd('pkg', '新描述'));
      expect(readFileSync(join(dir, 'extra.md'), 'utf8')).toBe('新增\n');
      expect(readFileSync(join(dir, 'note.txt'), 'utf8')).toBe('旧笔记');
    } finally {
      s.dispose();
    }
  });

  test('U3: the update write surface only writes inside this skill subdirectory (escape / target already a directory / through a symlink -> 400)', async () => {
    const skillsDir = makeRoot();
    const dir = join(skillsDir, 'victim');
    mkdirSync(dir);
    writeFileSync(join(dir, 'SKILL.md'), skillMd('victim', 'd'));
    mkdirSync(join(dir, 'already-dir'));
    const outside = join(skillsDir, 'outside-target');
    mkdirSync(outside);
    symlinkSync(outside, join(dir, 'linked'));
    const s = bootServer({ skillsDir });
    try {
      const escapeReq = await req(
        s.app,
        'PUT',
        `/api/teams/${s.team.id}/skills/victim`,
        createBody('victim', 'd', [{ path: '../escape.txt', content: 'x' }]),
      );
      expect(escapeReq.status).toBe(400);

      const isDir = await req(
        s.app,
        'PUT',
        `/api/teams/${s.team.id}/skills/victim`,
        createBody('victim', 'd', [{ path: 'already-dir', content: 'x' }]),
      );
      expect(isDir.status).toBe(400);

      const throughLink = await req(
        s.app,
        'PUT',
        `/api/teams/${s.team.id}/skills/victim`,
        createBody('victim', 'd', [{ path: 'linked/x.txt', content: 'x' }]),
      );
      expect(throughLink.status).toBe(400);
      expect(existsSync(join(outside, 'x.txt'))).toBe(false);
    } finally {
      s.dispose();
    }
  });

  test('U4: renaming = new frontmatter in SKILL.md (the directory stays, the id follows the frontmatter); colliding with another id -> 409; renaming without SKILL.md -> 400', async () => {
    const skillsDir = makeRoot();
    const dir = join(skillsDir, 'old-name');
    mkdirSync(dir);
    writeFileSync(join(dir, 'SKILL.md'), skillMd('old-name', 'd'));
    mkdirSync(join(skillsDir, 'other'));
    writeFileSync(join(skillsDir, 'other', 'SKILL.md'), skillMd('taken', 'd'));
    const s = bootServer({ skillsDir });
    try {
      const renamed = await req(
        s.app,
        'PUT',
        `/api/teams/${s.team.id}/skills/old-name`,
        createBody('fresh-id', '新描述'),
      );
      expect(renamed.status).toBe(200);
      expect(skillRecordSchema.parse(await renamed.json())).toMatchObject({ id: 'fresh-id' });
      expect((await req(s.app, 'GET', `/api/teams/${s.team.id}/skills/old-name`)).status).toBe(404);
      expect((await req(s.app, 'GET', `/api/teams/${s.team.id}/skills/fresh-id`)).status).toBe(200);

      const collide = await req(
        s.app,
        'PUT',
        `/api/teams/${s.team.id}/skills/fresh-id`,
        createBody('taken', 'd'),
      );
      expect(collide.status).toBe(409);

      const noMd = await req(s.app, 'PUT', `/api/teams/${s.team.id}/skills/fresh-id`, {
        name: 'another-id',
        description: '新描述',
        files: [{ path: 'a.txt', content: 'x' }],
      });
      expect(noMd.status).toBe(400);
    } finally {
      s.dispose();
    }
  });

  test('U5: an update without SKILL.md -- the declaration must match the current frontmatter, otherwise 400', async () => {
    const skillsDir = makeRoot();
    const dir = join(skillsDir, 'fixed');
    mkdirSync(dir);
    writeFileSync(join(dir, 'SKILL.md'), skillMd('fixed', '锁定描述'));
    const s = bootServer({ skillsDir });
    try {
      const wrongDesc = await req(s.app, 'PUT', `/api/teams/${s.team.id}/skills/fixed`, {
        name: 'fixed',
        description: '别的描述',
        files: [{ path: 'a.txt', content: 'x' }],
      });
      expect(wrongDesc.status).toBe(400);
      expect(await errorText(wrongDesc)).toContain('SKILL.md');

      const ok = await req(s.app, 'PUT', `/api/teams/${s.team.id}/skills/fixed`, {
        name: 'fixed',
        description: '锁定描述',
        files: [{ path: 'a.txt', content: 'x' }],
      });
      expect(ok.status).toBe(200);
    } finally {
      s.dispose();
    }
  });

  test('A1: both REST actions write an audit row each (actor member, all fields, bytes = the bytes written)', async () => {
    const skillsDir = makeRoot();
    const s = bootServer({ skillsDir });
    try {
      const created = createBody('audit', '审计面', [{ path: 'a.txt', content: '12345' }]);
      await req(s.app, 'POST', '/api/skills', created);
      await req(s.app, 'PUT', `/api/teams/${s.team.id}/skills/audit`, created);
      const rows = s.db.select().from(skillAudit).all();
      expect(rows).toHaveLength(2);
      type AuditRow = typeof skillAudit.$inferSelect;
      const [createRow, updateRow] = rows.sort((a, b) => a.createdAt - b.createdAt) as [
        AuditRow,
        AuditRow,
      ];
      const bytes = created.files.reduce((sum, f) => sum + Buffer.byteLength(f.content, 'utf8'), 0);
      for (const row of [createRow, updateRow]) {
        expect(row.skillId).toBe('audit');
        expect(row.actorType).toBe('member');
        expect(row.actorId).toBe(s.user.id);
        expect(row.bytes).toBe(bytes);
      }
      expect(createRow.action).toBe('create');
      expect(updateRow.action).toBe('update');
    } finally {
      s.dispose();
    }
  });
});

const WORKER_AGENT_ID = 'agent-skill-writer';

describe('the worker relay skill-write verbs (POST /api/machine/tool/{stepId})', () => {
  async function workerWorld(opts: { tools: string[] }) {
    const skillsDir = makeRoot();
    const s = bootServer({ skillsDir, claimHoldMs: 250 });
    const key = await issueApiKey(s);
    const enroll = await call(s.app, 'POST', '/api/machine/enroll', {
      cred: key,
      body: { teamId: s.team.id, name: 'skill-write', cliVersion: '0.1.0' },
    });
    const { token } = (await enroll.json()) as { token: string };
    s.db
      .insert(agentTable)
      .values({
        id: WORKER_AGENT_ID,
        teamId: s.team.id,
        displayName: '写技能的',
        provider: 'p',
        modelId: 'm',
        tools: opts.tools,
        defaultSkill: null,
        skillsAllowlist: null,
      })
      .run();
    bindAllAgents(s);

    const projectId = await postProject(s.app);
    const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      body: { title: '', spec: '写一个部署技能\n\n现在的情况：部署靠手工' },
    });
    const { id: todoId } = (await todoRes.json()) as { id: string };
    await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
      body: {
        todoIds: [todoId],
        assignment: { plan: null, build: { agentId: WORKER_AGENT_ID } },
        withPlan: false,
      },
    });
    const claimRes = await call(s.app, 'POST', '/api/machine/tasks/claim', {
      cred: token,
      body: {},
    });
    const { step } = (await claimRes.json()) as { step: ClaimedStep | null };
    if (!step) throw new Error('no step claimed');
    return { s, skillsDir, token, step };
  }

  const relay = (app: Hono, token: string, stepId: string, body: unknown) =>
    call(app, 'POST', `/api/machine/tool/${stepId}`, {
      cred: token,
      body: { name: 'create_skill', params: body },
    });

  test('R1: the claim vocabulary always lists create_skill / update_skill (workers always do)', async () => {
    const { s, step } = await workerWorld({ tools: [] });
    try {
      expect(step.remoteTools?.map((t) => t.name)).toContain('create_skill');
      expect(step.remoteTools?.map((t) => t.name)).toContain('update_skill');
    } finally {
      s.dispose();
    }
  });

  test('R2: without the create-skill toggle -> 403 with the toggle named (the Agent detail page permissions tab)', async () => {
    const { s, token, step } = await workerWorld({ tools: [] });
    try {
      const res = await relay(s.app, token, step.step.id, createBody('denied', '无权'));
      expect(res.status).toBe(403);
      const text = await errorText(res);
      expect(text).toContain(AGENT_TOOL_SKILL_CREATE);
      expect(text).toContain('未获');
    } finally {
      s.dispose();
    }
  });

  test('R3: with the create_skill toggle -> 200 written to disk + an audit row', async () => {
    const { s, skillsDir, token, step } = await workerWorld({
      tools: [AGENT_TOOL_SKILL_CREATE],
    });
    try {
      const res = await relay(s.app, token, step.step.id, createBody('by-agent', 'agent 建'));
      expect(res.status).toBe(200);
      const { text } = (await res.json()) as { text: string };
      expect(skillRecordSchema.parse(JSON.parse(text))).toMatchObject({ id: 'by-agent' });
      expect(readFileSync(join(skillsDir, 'by-agent', 'SKILL.md'), 'utf8')).toContain('by-agent');
      const rows = s.db.select().from(skillAudit).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        skillId: 'by-agent',
        actorType: 'agent',
        actorId: WORKER_AGENT_ID,
        action: 'create',
      });
    } finally {
      s.dispose();
    }
  });

  test('R4: update_skill follows the same rule -- without update-skill -> 403; with it -> 200 written to disk + audited', async () => {
    const { s, skillsDir, token, step } = await workerWorld({ tools: [] });
    try {
      mkdirSync(join(skillsDir, 'seeded'));
      writeFileSync(join(skillsDir, 'seeded', 'SKILL.md'), skillMd('seeded', '旧'));
      const denied = await call(s.app, 'POST', `/api/machine/tool/${step.step.id}`, {
        cred: token,
        body: {
          name: 'update_skill',
          params: { skillId: 'seeded', ...createBody('seeded', '新') },
        },
      });
      expect(denied.status).toBe(403);
      expect(await errorText(denied)).toContain(AGENT_TOOL_SKILL_UPDATE);
      s.db
        .update(agentTable)
        .set({ tools: [AGENT_TOOL_SKILL_UPDATE] })
        .where(eq(agentTable.id, WORKER_AGENT_ID))
        .run();
      const ok = await call(s.app, 'POST', `/api/machine/tool/${step.step.id}`, {
        cred: token,
        body: {
          name: 'update_skill',
          params: { skillId: 'seeded', ...createBody('seeded', '新') },
        },
      });
      expect(ok.status).toBe(200);
      expect(readFileSync(join(skillsDir, 'seeded', 'SKILL.md'), 'utf8')).toContain('新');
      const rows = s.db.select().from(skillAudit).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        skillId: 'seeded',
        actorType: 'agent',
        actorId: WORKER_AGENT_ID,
        action: 'update',
      });
    } finally {
      s.dispose();
    }
  });
});

describe('the chief relay skill-write verbs (no toggle, actor = the bound agent)', () => {
  const CHIEF_AGENT_ID = 'agent-chief-bound';

  function setup() {
    const skillsDir = makeRoot();
    const s = bootServer({ skillsDir });
    s.db
      .insert(agentTable)
      .values({
        id: CHIEF_AGENT_ID,
        teamId: s.team.id,
        displayName: '总管绑定',
        provider: 'p',
        modelId: 'm',
        tools: [],
        defaultSkill: null,
        skillsAllowlist: null,
      })
      .run();
    const ctx: ChiefToolCtx = {
      teamId: s.team.id,
      userId: s.user.id,
      chiefId: 'chief-x',
      threadId: 'chief-thread-x',
      chiefAgentId: CHIEF_AGENT_ID,
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

  test('K1: create_skill works without the toggle + an audit row (actor = the bound agent)', async () => {
    const { s, skillsDir, deps, ctx } = setup();
    try {
      const text = await executeChiefTool(
        deps,
        ctx,
        'create_skill',
        createBody('chief-made', '总管建'),
      );
      expect(skillRecordSchema.parse(JSON.parse(text))).toMatchObject({ id: 'chief-made' });
      expect(readFileSync(join(skillsDir, 'chief-made', 'SKILL.md'), 'utf8')).toContain(
        'chief-made',
      );
      const rows = s.db.select().from(skillAudit).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        skillId: 'chief-made',
        actorType: 'agent',
        actorId: CHIEF_AGENT_ID,
        action: 'create',
      });
    } finally {
      s.dispose();
    }
  });

  test('K2: update_skill works without the toggle + an audit row', async () => {
    const { s, skillsDir, deps, ctx } = setup();
    try {
      mkdirSync(join(skillsDir, 'chief-skill'));
      writeFileSync(join(skillsDir, 'chief-skill', 'SKILL.md'), skillMd('chief-skill', '旧'));
      const text = await executeChiefTool(deps, ctx, 'update_skill', {
        skillId: 'chief-skill',
        ...createBody('chief-skill', '新'),
      });
      expect(skillRecordSchema.parse(JSON.parse(text))).toMatchObject({
        id: 'chief-skill',
        description: '新',
      });
      expect(readFileSync(join(skillsDir, 'chief-skill', 'SKILL.md'), 'utf8')).toContain('新');
      expect(s.db.select().from(skillAudit).all()).toHaveLength(1);
    } finally {
      s.dispose();
    }
  });

  test('K3: update_skill with an unknown skillId -> 404', async () => {
    const { s, deps, ctx } = setup();
    try {
      await expect(
        executeChiefTool(deps, ctx, 'update_skill', {
          skillId: 'ghost',
          ...createBody('ghost', 'd'),
        }),
      ).rejects.toThrowError(/skill ghost/);
    } finally {
      s.dispose();
    }
  });

  test('K1 addendum: without a bound agent the actor = the member (userId)', async () => {
    const { s, deps, ctx } = setup();
    ctx.chiefAgentId = null;
    try {
      await executeChiefTool(deps, ctx, 'create_skill', createBody('user-made', '人建'));
      const rows = s.db.select().from(skillAudit).all();
      expect(rows[0]).toMatchObject({ actorType: 'member', actorId: s.user.id });
    } finally {
      s.dispose();
    }
  });
});

describe('machine-wire skill listing and on-demand fetch (GET /api/machine/skills/{stepId}[/file])', () => {
  async function claimWorld(
    opts: { defaultSkill?: string | null; skillsAllowlist?: string[] | null; root?: string } = {},
  ) {
    const skillsDir = opts.root ?? makeRoot();
    if (opts.root === undefined) {
      for (const name of ['alpha', 'beta']) {
        mkdirSync(join(skillsDir, name));
        writeFileSync(join(skillsDir, name, 'SKILL.md'), skillMd(name, `${name} 技能`));
        writeFileSync(join(skillsDir, name, 'helper.md'), `${name} 助手文件\n`);
      }
    }
    const s = bootServer({ skillsDir, claimHoldMs: 250 });
    const key = await issueApiKey(s);
    const enroll = await call(s.app, 'POST', '/api/machine/enroll', {
      cred: key,
      body: { teamId: s.team.id, name: 'skill-pkg', cliVersion: '0.1.0' },
    });
    const { token } = (await enroll.json()) as { token: string };
    s.db
      .insert(agentTable)
      .values({
        id: WORKER_AGENT_ID,
        teamId: s.team.id,
        displayName: '领技能包的',
        provider: 'p',
        modelId: 'm',
        tools: [],
        defaultSkill: opts.defaultSkill ?? null,
        skillsAllowlist: opts.skillsAllowlist ?? null,
      })
      .run();
    bindAllAgents(s);
    const projectId = await postProject(s.app);
    const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      body: { title: '', spec: '干活\n\n现在的情况：没技能' },
    });
    const { id: todoId } = (await todoRes.json()) as { id: string };
    await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
      body: {
        todoIds: [todoId],
        assignment: { plan: null, build: { agentId: WORKER_AGENT_ID } },
        withPlan: false,
      },
    });
    const claimRes = await call(s.app, 'POST', '/api/machine/tasks/claim', {
      cred: token,
      body: {},
    });
    const { step } = (await claimRes.json()) as { step: ClaimedStep | null };
    if (!step) throw new Error('no step claimed');
    return { s, skillsDir, token, step, key };
  }

  const pkg = (app: Hono, cred: string, stepId: string) =>
    call(app, 'GET', `/api/machine/skills/${stepId}`, { cred });

  const fileGet = (app: Hono, cred: string, stepId: string, dirName: string, path: string) =>
    call(
      app,
      'GET',
      `/api/machine/skills/${stepId}/file?${new URLSearchParams({ dirName, path }).toString()}`,
      { cred },
    );

  function sha256Hex(bytes: Buffer): string {
    return createHash('sha256').update(bytes).digest('hex');
  }

  test('M1/M2: the whitelist intersection produces the listing; outside the whitelist is not listed', async () => {
    const { s, token, step, skillsDir } = await claimWorld({ skillsAllowlist: ['alpha', 'ghost'] });
    try {
      const res = await pkg(s.app, token, step.step.id);
      expect(res.status).toBe(200);
      const body = machineSkillsManifestResponseSchema.parse(await res.json());
      expect(body.selection).toBe('whitelist');
      expect(body.skills).toHaveLength(1);
      const alpha = body.skills[0]!;
      expect(alpha).toMatchObject({ id: 'alpha', name: 'alpha', dirName: 'alpha' });
      expect(alpha.files.map((f) => f.path).sort()).toEqual(['SKILL.md', 'helper.md']);
      for (const f of alpha.files) {
        const onDisk = readFileSync(join(skillsDir, 'alpha', f.path));
        expect(f.sizeBytes).toBe(onDisk.byteLength);
        expect(f.sha256).toBe(sha256Hex(onDisk));
      }
    } finally {
      s.dispose();
    }
  });

  test('M3/M4/M10: a credential of another step (another machine token) -> 404; an unknown stepId -> 404 (both the listing and file surfaces)', async () => {
    const { s, token, step } = await claimWorld({ skillsAllowlist: ['alpha'] });
    try {
      const key2 = await issueApiKey(s);
      const enroll2 = await call(s.app, 'POST', '/api/machine/enroll', {
        cred: key2,
        body: { teamId: s.team.id, name: 'other-machine', cliVersion: '0.1.0' },
      });

      bindAllAgents(s);
      const { token: token2 } = (await enroll2.json()) as { token: string };
      const notYours = await pkg(s.app, token2, step.step.id);
      expect(notYours.status).toBe(404);
      const unknown = await pkg(s.app, token, 'no-such-step');
      expect(unknown.status).toBe(404);
      const fileNotYours = await fileGet(s.app, token2, step.step.id, 'alpha', 'SKILL.md');
      expect(fileNotYours.status).toBe(404);
      const fileUnknown = await fileGet(s.app, token, 'no-such-step', 'alpha', 'SKILL.md');
      expect(fileUnknown.status).toBe(404);
    } finally {
      s.dispose();
    }
  });

  test('M5: an over-limit file no longer fails the whole package -- an asset past the per-file gate enters the listing with its real size and is delivered byte-complete; a total over the old package gate still gets a listing', async () => {
    const fatRoot = makeRoot();
    mkdirSync(join(fatRoot, 'fat'));
    writeFileSync(join(fatRoot, 'fat', 'SKILL.md'), skillMd('fat', '大'));
    const big = Buffer.from('x'.repeat(MAX_SKILL_FILE_BYTES + 1), 'utf8');
    writeFileSync(join(fatRoot, 'fat', 'big.txt'), big);
    const fatWorld = await claimWorld({ skillsAllowlist: ['fat'], root: fatRoot });
    try {
      const res = await pkg(fatWorld.s.app, fatWorld.token, fatWorld.step.step.id);
      expect(res.status).toBe(200);
      const body = machineSkillsManifestResponseSchema.parse(await res.json());
      const bigEntry = body.skills[0]!.files.find((f) => f.path === 'big.txt');
      expect(bigEntry).toBeDefined();
      expect(bigEntry!.sizeBytes).toBe(big.byteLength);
      expect(bigEntry!.sha256).toBe(sha256Hex(big));
      const fileRes = await fileGet(
        fatWorld.s.app,
        fatWorld.token,
        fatWorld.step.step.id,
        'fat',
        'big.txt',
      );
      expect(fileRes.status).toBe(200);
      expect(Buffer.from(await fileRes.arrayBuffer())).toEqual(big);
    } finally {
      fatWorld.s.dispose();
    }

    const heavyRoot = makeRoot();
    mkdirSync(join(heavyRoot, 'heavy'));
    writeFileSync(join(heavyRoot, 'heavy', 'SKILL.md'), skillMd('heavy', '重'));
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(heavyRoot, 'heavy', `p${i}.txt`), 'x'.repeat(450_000));
    }
    const heavyWorld = await claimWorld({ skillsAllowlist: ['heavy'], root: heavyRoot });
    try {
      const totalOnDisk = 5 * 450_000;
      expect(totalOnDisk).toBeGreaterThan(MAX_SKILL_TOTAL_BYTES);
      const res = await pkg(heavyWorld.s.app, heavyWorld.token, heavyWorld.step.step.id);
      expect(res.status).toBe(200);
      const body = machineSkillsManifestResponseSchema.parse(await res.json());
      expect(body.skills[0]!.files).toHaveLength(6);
      expect(body.skills[0]!.files.reduce((n, f) => n + f.sizeBytes, 0)).toBeGreaterThan(
        MAX_SKILL_TOTAL_BYTES,
      );
    } finally {
      heavyWorld.s.dispose();
    }
  });

  test('M6: a chief step = the full directory (the trust surface is not bound by the whitelist)', async () => {
    const skillsDir = makeRoot();
    for (const name of ['alpha', 'beta']) {
      mkdirSync(join(skillsDir, name));
      writeFileSync(join(skillsDir, name, 'SKILL.md'), skillMd(name, `${name} 技能`));
    }
    const s = bootServer({ skillsDir, claimHoldMs: 250 });
    const key = await issueApiKey(s);
    const enroll = await call(s.app, 'POST', '/api/machine/enroll', {
      cred: key,
      body: { teamId: s.team.id, name: 'chief-pkg', cliVersion: '0.1.0' },
    });
    const { token } = (await enroll.json()) as { token: string };
    s.db
      .insert(agentTable)
      .values({
        id: WORKER_AGENT_ID,
        teamId: s.team.id,
        displayName: '总管',
        provider: 'p',
        modelId: 'stub-model',
        tools: [],
        defaultSkill: null,
        skillsAllowlist: null,
      })
      .run();
    bindAllAgents(s);

    await call(s.app, 'PATCH', `/api/teams/${s.team.id}/chief`, {
      body: { agent: { agentId: WORKER_AGENT_ID, thinkingLevel: null } },
    });
    await call(s.app, 'POST', `/api/teams/${s.team.id}/chief/threads`, {
      body: { content: '整理一下团队技能。' },
    });
    const claimRes = await call(s.app, 'POST', '/api/machine/tasks/claim', {
      cred: token,
      body: {},
    });
    const { step } = (await claimRes.json()) as { step: ClaimedStep | null };
    if (!step) throw new Error('no chief step claimed');
    try {
      expect(step.step.kind).toBe('chief');
      const res = await pkg(s.app, token, step.step.id);
      expect(res.status).toBe(200);
      const body = machineSkillsManifestResponseSchema.parse(await res.json());
      expect(body.selection).toBe('all');
      expect(body.skills.map((sk) => sk.id)).toEqual(['alpha', 'beta']);
    } finally {
      s.dispose();
    }
  });

  test('M7: an explicit empty selection (skillsAllowlist: []) = an empty listing, no crash (selection=whitelist)', async () => {
    const { s, token, step } = await claimWorld({ skillsAllowlist: [] });
    try {
      const res = await pkg(s.app, token, step.step.id);
      expect(res.status).toBe(200);
      const body = machineSkillsManifestResponseSchema.parse(await res.json());
      expect(body).toEqual({ selection: 'whitelist', skills: [] });
    } finally {
      s.dispose();
    }
  });

  test('M8 (#1169): a worker step with skillsAllowlist=null (unrestricted) -> selection=all, the full listing', async () => {
    const { s, token, step } = await claimWorld({ skillsAllowlist: null });
    try {
      const res = await pkg(s.app, token, step.step.id);
      expect(res.status).toBe(200);
      const body = machineSkillsManifestResponseSchema.parse(await res.json());
      expect(body.selection).toBe('all');
      expect(body.skills.map((sk) => sk.id)).toEqual(['alpha', 'beta']);
    } finally {
      s.dispose();
    }
  });

  test('M8: the file endpoint serves raw bytes -- text byte for byte, binaries honest (non-utf8 not corrupted)', async () => {
    const root = makeRoot();
    mkdirSync(join(root, 'bin'));
    writeFileSync(join(root, 'bin', 'SKILL.md'), skillMd('bin', '二进制'));
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe]);
    mkdirSync(join(root, 'bin', 'assets'));
    writeFileSync(join(root, 'bin', 'assets', 'logo.png'), png);
    const { s, token, step } = await claimWorld({ skillsAllowlist: ['bin'], root });
    try {
      const res = await fileGet(s.app, token, step.step.id, 'bin', 'assets/logo.png');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/octet-stream');
      expect(Buffer.from(await res.arrayBuffer())).toEqual(png);
      const manifestRes = await pkg(s.app, token, step.step.id);
      const body = machineSkillsManifestResponseSchema.parse(await manifestRes.json());
      const entry = body.skills[0]!.files.find((f) => f.path === 'assets/logo.png');
      expect(entry).toEqual({
        path: 'assets/logo.png',
        sizeBytes: png.byteLength,
        sha256: sha256Hex(png),
      });
    } finally {
      s.dispose();
    }
  });

  test('M9: the file endpoint 404 surface -- skills outside the whitelist / paths outside the listing (unknown file, directory, symlink) / escape forms, none leaks existence', async () => {
    const root = makeRoot();
    for (const name of ['alpha', 'beta']) {
      mkdirSync(join(root, name));
      writeFileSync(join(root, name, 'SKILL.md'), skillMd(name, `${name} 技能`));
    }
    mkdirSync(join(root, 'alpha', 'refs'));
    writeFileSync(join(root, 'alpha', 'refs', 'inner.md'), 'inner\n');
    writeFileSync(join(root, 'outside-secret.txt'), 'server 侧技能根外的秘密\n');
    symlinkSync(join(root, 'outside-secret.txt'), join(root, 'alpha', 'leak.txt'));
    const { s, token, step } = await claimWorld({ skillsAllowlist: ['alpha'], root });
    const stepId = step.step.id;
    try {
      const cases: [string, string][] = [
        ['beta', 'SKILL.md'],
        ['alpha', 'no-such.md'],
        ['alpha', 'refs'],
        ['alpha', 'refs/inner.md/../SKILL.md'],
        ['alpha', '../beta/SKILL.md'],
        ['alpha', '/etc/hosts'],
        ['../alpha', 'SKILL.md'],
        ['alpha', 'leak.txt'],
      ];
      for (const [dirName, path] of cases) {
        const res = await fileGet(s.app, token, stepId, dirName, path);
        expect(res.status, `${dirName}/${path}`).toBe(404);
      }
      const ok = await fileGet(s.app, token, stepId, 'alpha', 'refs/inner.md');
      expect(ok.status).toBe(200);
      expect(Buffer.from(await ok.arrayBuffer()).toString('utf8')).toBe('inner\n');
    } finally {
      s.dispose();
    }
  });
});
