import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
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
import { type StubLlm, startStubLlm } from './stub-llm.js';

const SKILL_MARKER = 'SKILLS-INJECT-MARKER-371';
const EXTRA_MARKER = 'EXTRA-BODY-MARKER-917';
const PI_NATIVE_MARKER = 'PI-NATIVE-DUP-MARKER-917';

let stub: StubLlm;
let server: RealServer;
let handle: MachineHandle;
let paths: StatePaths;
let home: string;
let skillsDir: string;
let skillFile: string;
let extraSkillFile: string;
let world: { projectId: string; todoId: string };
let buildId = '';

function logLines(): string[] {
  return daemonLogLines(paths.daemonLog);
}

function collectConvActivities(convId: string): {
  latestSkills: () => { name: string; denied: boolean }[] | null;
  stop: () => void;
} {
  const ctrl = new AbortController();
  let latest: { name: string; denied: boolean }[] | null = null;
  void (async () => {
    const res = await fetch(`${server.url}/api/conversations/${convId}/stream`, {
      signal: ctrl.signal,
    });
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += decoder.decode(value, { stream: true });
      let idx = buf.indexOf('\n\n');
      while (idx >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          try {
            const ev = JSON.parse(line.slice(5).trim()) as {
              type: string;
              activity?: { skills?: { name: string; denied: boolean }[] };
            };
            if (ev.type === 'activity' && ev.activity?.skills !== undefined) {
              latest = ev.activity.skills;
            }
          } catch {}
        }
        idx = buf.indexOf('\n\n');
      }
    }
  })().catch(() => {});
  return { latestSkills: () => latest, stop: () => ctrl.abort() };
}

beforeAll(async () => {
  skillsDir = mkdtempSync(join(tmpdir(), 'cairn-it-skills-'));
  const dir = join(skillsDir, 'demo-skill');
  mkdirSync(dir, { recursive: true });
  skillFile = join(dir, 'SKILL.md');
  writeFileSync(
    skillFile,
    [
      '---',
      'name: demo-skill',
      `description: 演示技能：读到正文即证明 skills 目录可达（${SKILL_MARKER}）。`,
      '---',
      '',
      '# demo-skill',
      '',
      `正文 marker：${SKILL_MARKER}`,
      '',
    ].join('\n'),
    'utf8',
  );
  extraSkillFile = join(skillsDir, 'extra-skill', 'SKILL.md');
  mkdirSync(join(skillsDir, 'extra-skill'), { recursive: true });
  writeFileSync(
    extraSkillFile,
    [
      '---',
      'name: extra-skill',
      'description: 白名单外对照技能。',
      '---',
      '',
      `extra body ${EXTRA_MARKER}`,
      '',
    ].join('\n'),
    'utf8',
  );

  stub = await startStubLlm([
    { toolCall: { name: 'read', arguments: { path: extraSkillFile } } },
    { toolCall: { name: 'read', arguments: { path: skillFile } } },
    { toolCall: { name: 'bash', arguments: { command: 'printf "skills probe\\n" >> README.md' } } },
    { content: '已读取演示技能。' },
  ]);
  server = await bootRealServer({
    providerBaseUrl: stub.url,
    claimHoldMs: 1_000,
    agentDescription: '你是集成测试 Agent：按指令使用工具，然后简短汇报。',
  });
  server.db
    .update(agentTable)
    .set({ skillsAllowlist: ['demo-skill'] })
    .where(eq(agentTable.id, AGENT_ID))
    .run();
  home = mkdtempSync(join(tmpdir(), 'cairn-it-skills-home-'));
  const config = loadDaemonConfig(
    {
      serverUrl: server.url,
      apiKey: server.apiKey,
      teamId: server.teamId,
      home,
      name: 'skills-inject-mbp',
      skillsDir,
    },
    {},
  );
  paths = statePaths(config.home, config.workspacesDir);
  const nativeDupDir = join(paths.agentRuntimeDir, 'skills', 'native-dup');
  mkdirSync(nativeDupDir, { recursive: true });
  writeFileSync(
    join(nativeDupDir, 'SKILL.md'),
    [
      '---',
      'name: native-dup',
      `description: pi 原生发现面对照（${PI_NATIVE_MARKER}）。`,
      '---',
      '',
      'native dup body.',
      '',
    ].join('\n'),
    'utf8',
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
  if (skillsDir) rmSync(skillsDir, { recursive: true, force: true });
  process.stdout.write(
    `\n[diag] stub requests consumed: ${stub?.requests.length ?? -1}\n[diag] daemon.log tail:\n${diagTail}\n`,
  );
});

describe('spec 14 skills execution-plane injection E2E', () => {
  test('systemPrompt carries the catalog XML (appended, not overwritten); agent read of SKILL.md lands in DB (connectivity hard acceptance)', async () => {
    world = await seedWorld(
      server.url,
      server.teamId,
      { title: 'skills 注入探针', spec: '读取 demo-skill 演示技能并汇报 marker。' },
      { projectName: 'skills-inject' },
    );
    const started = await api(server.url, 'POST', `/api/projects/${world.projectId}/builds`, {
      todoIds: [world.todoId],
      assignment: { plan: null, build: { agentId: AGENT_ID } },
      withPlan: false,
    });
    expect(started.status).toBe(201);
    buildId = (started.body as { builds: { id: string }[] }).builds[0]!.id;
    const activities = collectConvActivities(buildId);

    await waitFor(() => server.todoPhase(world.todoId) === 'review', 150_000);

    try {
      await waitFor(() => {
        const skills = activities.latestSkills() ?? [];
        return (
          skills.some((s) => s.name === 'demo-skill' && !s.denied) &&
          skills.some((s) => s.name === 'extra-skill' && s.denied)
        );
      }, 15_000);
    } finally {
      activities.stop();
    }

    const first = stub.requests[0]!;
    const flat = JSON.stringify(first.messages);
    expect(flat).toContain('<available_skills>');
    expect(flat).toContain('<name>demo-skill</name>');
    expect(flat).toContain(skillFile);
    expect(flat).toContain('你是集成测试 Agent');
    expect(flat).not.toContain('extra-skill');

    const msgs = server.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.conversationId, buildId))
      .all();
    expect(JSON.stringify(msgs)).toContain(SKILL_MARKER);

    expect(logLines().some((l) => l.startsWith('[skills] loaded: 1 skills from'))).toBe(true);
    expect(logLines()).toContain('[skills] filtered: extra-skill not in agent allowlist');

    const msgsFlat = JSON.stringify(msgs);
    expect(msgsFlat).toContain('not in the agent allowlist');
    expect(msgsFlat).toContain('extra-skill');
    expect(msgsFlat).not.toContain(EXTRA_MARKER);
    expect(logLines().some((l) => l.startsWith('[skills] catalog: entries=1 '))).toBe(true);
    expect(logLines()).toContain('[skills] deny: 1 skill dir(s) hard-blocked');
    expect(logLines().some((l) => l.startsWith('[skills] denied-read:'))).toBe(true);
    expect(logLines().some((l) => l.includes('denied-read:') && l.includes(extraSkillFile))).toBe(
      true,
    );

    expect(flat).not.toContain(PI_NATIVE_MARKER);
    expect(flat).not.toContain('native-dup');

    expect(logLines().some((l) => l.includes('brief written:') && l.includes('(create)'))).toBe(
      true,
    );
    expect(logLines().some((l) => l.includes('brief removed'))).toBe(true);
    expect(existsSync(join(paths.workspacesDir, buildId, 'AGENTS.md'))).toBe(false);
  }, 150_000);
});
