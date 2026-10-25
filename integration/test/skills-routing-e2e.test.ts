import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { discoverNativeSkills } from '../../apps/daemon/src/backend/skills.js';
import { loadDaemonConfig } from '../../apps/daemon/src/config.js';
import { createDaemonLogger } from '../../apps/daemon/src/log.js';
import { type MachineHandle, runMachine } from '../../apps/daemon/src/machine-loop.js';
import { type StatePaths, statePaths } from '../../apps/daemon/src/state.js';
import { agent as agentTable, message as messageTable } from '../../apps/server/src/db/schema.js';
import {
  AGENT_ID,
  api,
  bootRealServer,
  daemonLogLines,
  type RealServer,
  seedWorld,
  waitFor,
} from './helpers.js';
import { type StubLlm, type StubResponse, startStubLlm } from './stub-llm.js';

const TEAM_ALPHA_MARKER = 'TEAM-ALPHA-MARKER-919';
const TEAM_NOTES_MARKER = 'TEAM-NOTES-MARKER-919';
const LOCAL_ONE_MARKER = 'LOCAL-ONE-MARKER-919';
const LOCAL_BLOCKED_MARKER = 'LOCAL-BLOCKED-MARKER-919';
const NATIVE_DUP_MARKER = 'PI-NATIVE-DUP-MARKER-919';
const ALLOWLIST = ['alpha-skill', 'beta-skill', 'gamma-skill', 'local-one'];

let stub: StubLlm;
let stubRounds: StubResponse[];
let server: RealServer;
let handle: MachineHandle;
let paths: StatePaths;
let home: string;
let localSkillsDir: string;
let localOneFile: string;
let localBlockedFile: string;
let world1: { projectId: string; todoId: string };
let build1Id = '';
let world2: { projectId: string; todoId: string };

function logLines(): string[] {
  return daemonLogLines(paths.daemonLog);
}

function writeSkill(dir: string, name: string, description: string, body: string): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'SKILL.md');
  writeFileSync(file, `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`, 'utf8');
  return file;
}

function locationOf(flat: string, name: string): string {
  const m = new RegExp(`<name>${name}</name>[\\s\\S]*?<location>([^<]+)</location>`).exec(flat);
  if (m === null) throw new Error(`catalog location not found for ${name}`);
  return m[1]!;
}

beforeAll(async () => {
  stubRounds = [
    { toolCall: { name: 'read', arguments: { path: '<local-blocked>' } } },
    { content: 'SENTINEL-EARLY-EXIT-919' },
  ];
  stub = await startStubLlm(stubRounds, {
    onConsumed: () => {
      if (stubRounds.length !== 2) return;
      const flat = JSON.stringify(stub.requests[0]?.messages ?? []);
      const teamAlpha = locationOf(flat, 'alpha-skill');
      stubRounds.splice(
        1,
        1,
        { toolCall: { name: 'read', arguments: { path: teamAlpha } } },
        { toolCall: { name: 'read', arguments: { path: localOneFile } } },
        {
          toolCall: {
            name: 'bash',
            arguments: { command: 'printf "routing probe\\n" >> README.md' },
          },
        },
        { content: '已按目录读取团队与本机技能。' },
      );
    },
  });
  server = await bootRealServer({
    providerBaseUrl: stub.url,
    claimHoldMs: 1_000,
    agentDescription: '你是集成测试 Agent：按指令使用工具，然后简短汇报。',
  });
  writeSkill(
    join(server.skillsDir, 'alpha-skill'),
    'alpha-skill',
    '团队分发技能甲：读到正文即证明远端字节到达。',
    `团队甲正文：${TEAM_ALPHA_MARKER}`,
  );
  writeFileSync(
    join(server.skillsDir, 'alpha-skill', 'notes.md'),
    `引用文件正文：${TEAM_NOTES_MARKER}\n`,
    'utf8',
  );
  writeSkill(join(server.skillsDir, 'beta-skill'), 'beta-skill', '团队分发技能乙。', 'beta body.');
  writeSkill(
    join(server.skillsDir, 'gamma-skill'),
    'gamma-skill',
    '团队分发技能丙（目录末位——截顶先吃掉的就是尾部）。',
    'gamma body.',
  );
  server.db
    .update(agentTable)
    .set({ skillsAllowlist: ALLOWLIST })
    .where(eq(agentTable.id, AGENT_ID))
    .run();

  localSkillsDir = mkdtempSync(join(tmpdir(), 'cairn-it-routing-local-'));
  localOneFile = writeSkill(
    join(localSkillsDir, 'local-one'),
    'local-one',
    '本机授权技能。',
    `本机正文：${LOCAL_ONE_MARKER}`,
  );
  localBlockedFile = writeSkill(
    join(localSkillsDir, 'local-blocked'),
    'local-blocked',
    '本机未授权技能（硬挡对照）。',
    `本机未授权正文：${LOCAL_BLOCKED_MARKER}`,
  );
  stubRounds[0] = { toolCall: { name: 'read', arguments: { path: localBlockedFile } } };

  home = mkdtempSync(join(tmpdir(), 'cairn-it-routing-home-'));
  const config = loadDaemonConfig(
    {
      serverUrl: server.url,
      apiKey: server.apiKey,
      teamId: server.teamId,
      home,
      name: 'skills-routing-mbp',
      skillsDir: localSkillsDir,
    },
    {},
  );
  paths = statePaths(config.home, config.workspacesDir);
  const nativeDupDir = join(paths.agentRuntimeDir, 'skills', 'native-dup-919');
  writeSkill(
    nativeDupDir,
    'native-dup-919',
    `pi 原生发现面对照（${NATIVE_DUP_MARKER}）。`,
    'native dup body.',
  );
  const logger = createDaemonLogger({ logFile: paths.daemonLog });
  handle = await runMachine({
    config,
    paths,
    logger,
    idleSleepPrevention: false,
    proxyEnv: {},
    claimBackoffBaseMs: 50,
    heartbeatIntervalMs: 500,
  });
  await waitFor(() => logLines().includes('[wake] push channel connected'), 30_000);
}, 120_000);

afterAll(async () => {
  await handle?.stop();
  await handle?.done;
  await server?.close();
  await stub?.close();
  const diagTail = logLines().slice(-40).join('\n');
  if (home) rmSync(home, { recursive: true, force: true });
  if (localSkillsDir) rmSync(localSkillsDir, { recursive: true, force: true });
  process.stdout.write(
    `\n[diag] stub requests consumed: ${stub?.requests.length ?? -1}\n[diag] daemon.log tail:\n${diagTail}\n`,
  );
});

describe('spec 14 skill routing behavior acceptance E2E (#919)', () => {
  test('selected catalog injection + remote distribution materialized + allowlist hard-block both ways + native surface off contrast', async () => {
    world1 = await seedWorld(
      server.url,
      server.teamId,
      { title: '技能路由探针', spec: '按目录读取 alpha-skill 与 local-one 技能并汇报。' },
      { projectName: 'skills-routing' },
    );
    const started = await api(server.url, 'POST', `/api/projects/${world1.projectId}/builds`, {
      todoIds: [world1.todoId],
      assignment: { plan: null, build: { agentId: AGENT_ID } },
      withPlan: false,
    });
    expect(started.status).toBe(201);
    build1Id = (started.body as { builds: { id: string }[] }).builds[0]!.id;

    await waitFor(() => server.todoPhase(world1.todoId) === 'review', 150_000);

    const first = stub.requests[0]!;
    const flat = JSON.stringify(first.messages);

    expect(logLines().some((l) => l.startsWith('[skills] catalog: entries=2 '))).toBe(true);
    expect(logLines().some((l) => l.startsWith('[skills] loaded: 2 skills from'))).toBe(true);
    for (const name of ['alpha-skill', 'local-one']) {
      expect(flat).toContain(`<name>${name}</name>`);
    }
    expect(flat).not.toContain('<name>beta-skill</name>');
    expect(flat).not.toContain('<name>gamma-skill</name>');
    expect(flat).not.toContain('local-blocked');
    expect(logLines()).toContain('[skills] filtered: beta-skill not in injected selection');
    expect(logLines()).toContain('[skills] filtered: gamma-skill not in injected selection');
    expect(logLines().some((l) => l.includes('[skills] cap:'))).toBe(false);
    expect(logLines()).toContain('[skills] filtered: local-blocked not in agent allowlist');

    expect(
      logLines().some((l) => l.startsWith('[skills] team: 3 skill(s), 4 file(s) materialized')),
    ).toBe(true);
    const viewsRoot = join(paths.teamSkillsCacheDir, 'views');
    const views = readdirSync(viewsRoot).filter((n) => !n.startsWith('.tmp-'));
    expect(views.length).toBeGreaterThan(0);
    const alphaView = join(viewsRoot, views[0]!, 'alpha-skill');
    expect(readFileSync(join(alphaView, 'SKILL.md'), 'utf8')).toContain(TEAM_ALPHA_MARKER);
    expect(readFileSync(join(alphaView, 'notes.md'), 'utf8')).toContain(TEAM_NOTES_MARKER);
    expect(locationOf(flat, 'alpha-skill')).toBe(join(alphaView, 'SKILL.md'));

    const msgs = server.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.conversationId, build1Id))
      .all();
    const msgsFlat = JSON.stringify(msgs);
    expect(msgsFlat).toContain(TEAM_ALPHA_MARKER);
    expect(msgsFlat).toContain(LOCAL_ONE_MARKER);

    expect(msgsFlat).toContain('not in the agent allowlist');
    expect(msgsFlat).toContain('local-blocked');
    expect(msgsFlat).not.toContain(LOCAL_BLOCKED_MARKER);
    expect(logLines()).toContain('[skills] deny: 1 skill dir(s) hard-blocked');
    expect(logLines().some((l) => l.includes('denied-read:') && l.includes(localBlockedFile))).toBe(
      true,
    );

    const nativeDiscovered = await discoverNativeSkills({
      agentDir: paths.agentRuntimeDir,
      cwd: home,
    });
    expect(nativeDiscovered).toContain('native-dup-919');
    expect(flat).not.toContain(NATIVE_DUP_MARKER);
    expect(flat).not.toContain('native-dup-919');
  }, 180_000);

  test('empty allowlist: empty manifest spoken aloud (F6), session unaffected (F7)', async () => {
    await waitFor(() => stub.requests.length === 5, 30_000);
    server.db
      .update(agentTable)
      .set({ skillsAllowlist: [] })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    stubRounds.push(
      {
        toolCall: {
          name: 'bash',
          arguments: { command: 'printf "empty manifest probe\\n" >> README.md' },
        },
      },
      { content: '空清单轮完成。' },
    );
    world2 = await seedWorld(
      server.url,
      server.teamId,
      { title: '空清单探针', spec: '写一行并汇报。' },
      { projectName: 'skills-routing-empty' },
    );
    const started = await api(server.url, 'POST', `/api/projects/${world2.projectId}/builds`, {
      todoIds: [world2.todoId],
      assignment: { plan: null, build: { agentId: AGENT_ID } },
      withPlan: false,
    });
    expect(started.status).toBe(201);
    const build2Id = (started.body as { builds: { id: string }[] }).builds[0]!.id;

    await waitFor(() => server.todoPhase(world2.todoId) === 'review', 150_000);

    expect(
      logLines().some(
        (l) =>
          l.startsWith('[skills] team-manifest-empty: server distributed zero skills') &&
          l.includes('selection=whitelist'),
      ),
    ).toBe(true);
    expect(logLines().some((l) => l.startsWith('[skills] catalog: entries=0 '))).toBe(true);
    expect(logLines()).toContain('[skills] deny: 2 skill dir(s) hard-blocked');
    const req2 = stub.requests[5]!;
    const flat2 = JSON.stringify(req2.messages);
    expect(flat2).not.toContain('<available_skills>');
    expect(flat2).toContain('你是集成测试 Agent');
    const msgs2 = server.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.conversationId, build2Id))
      .all();
    expect(msgs2.length).toBeGreaterThan(0);
    expect(existsSync(join(paths.workspacesDir, build1Id, 'AGENTS.md'))).toBe(false);
  }, 180_000);
});
