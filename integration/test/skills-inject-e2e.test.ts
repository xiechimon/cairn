// skills 执行面注入 E2E（spec 14 / #371 + #372 per-agent 白名单 + #917 硬挡）：
// daemon 扫描 PACMAN_SKILLS_DIR → 按 agent.skills 勾选过滤 → `<available_skills>`
// catalog 追加进 session systemPrompt（不覆盖既有段）→ agent 按 catalog 指引用
// read 工具真读 SKILL.md（连通性硬验收：catalog 不能是装饰品——read 结果带正文
// marker 落库即证路径可达）。白名单面：授权 skill 在位、同目录未授权 skill
// 不出现（#372 验收一）。#917 增补（spec 14 §技能可见面收归）：白名单硬挡双向
// 证据——worker 步 read 授权 SKILL.md 得正文、read 未授权 SKILL.md 得拒绝文案
// 且其正文 marker 不落库；pi 原生 `<available_skills>` 段关断（noSkills——#958
// 接线实录的重复清单收口，agentDir/skills 种入的原生技能不得出现在 LLM 输入
// 面）；`[skills] catalog:/deny:/denied-read:` 观测行落盘。

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

/** SKILL.md 正文 marker：read 结果落库断言键（catalog 触发按需读的实证）。 */
const SKILL_MARKER = 'SKILLS-INJECT-MARKER-371';
/** 未授权技能正文 marker（#917 硬挡：此文本永不落库 = 拒绝面实证）。 */
const EXTRA_MARKER = 'EXTRA-BODY-MARKER-917';
/** pi 原生发现面 marker（#917 noSkills：种进 agentDir/skills 的原生技能
 * 不得出现在 LLM 输入面 = 重复清单收口实证）。 */
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

/** #918 activity 事件收集器：订阅会话流，持续记录**最新一份带 skills 的
 *  activity 载荷**（daemon 侧清单是累计集、随每份上报走——最后一份 = 全步
 *  事实）。证明链 = daemon 从工具流识别 → 第四形上报 → server 盖 {stepId,at}
 *  → SSE 会话流可达订阅端，全程真 wire。 */
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
          } catch {
            // 半帧防御
          }
        }
        idx = buf.indexOf('\n\n');
      }
    }
  })().catch(() => {});
  return { latestSkills: () => latest, stop: () => ctrl.abort() };
}

beforeAll(async () => {
  // fixture skills 目录：单 skill（frontmatter name + description + 正文 marker）。
  skillsDir = mkdtempSync(join(tmpdir(), 'pacman-it-skills-'));
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
  // 未授权对照 skill（#372 注入面 + #917 硬挡面）：同目录在位但 agent.skills
  // 白名单外——注入面必须不出现，read 面必须被拒（正文 marker 永不落库）。
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
    // 轮 1（#917 硬挡双向证据·拒侧）：read 未授权技能文件——门控 read 必须以
    // tool error 结果拒绝（文案带技能名），正文 marker 不得落库。
    { toolCall: { name: 'read', arguments: { path: extraSkillFile } } },
    // 轮 2（双向证据·放侧）：agent 按 catalog 指引 read 授权 SKILL.md（绝对
    // 路径 = catalog location）——正文 marker 落库。
    { toolCall: { name: 'read', arguments: { path: skillFile } } },
    // 轮 3：真做一处改动（#703 闸 2——执行步无改动过不了 review 闸）。
    { toolCall: { name: 'bash', arguments: { command: 'printf "skills probe\\n" >> README.md' } } },
    // 轮 4：收尾。
    { content: '已读取演示技能。' },
  ]);
  server = await bootRealServer({
    providerBaseUrl: stub.url,
    claimHoldMs: 1_000,
    agentDescription: '你是集成测试 Agent：按指令使用工具，然后简短汇报。',
  });
  // agent.skillsAllowlist 授权勾选（#372→#1169 正名）：worker 步只有授权
  // slug 进 catalog——demo-skill 勾选、extra-skill 不勾。
  server.db
    .update(agentTable)
    .set({ skillsAllowlist: ['demo-skill'] })
    .where(eq(agentTable.id, AGENT_ID))
    .run();
  home = mkdtempSync(join(tmpdir(), 'pacman-it-skills-home-'));
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
  // pi 原生发现面种入（#917 noSkills 实证）：agentDir/skills 是 pi resource
  // loader 的默认扫描位之一——#958 接线实录里它与 pacman catalog 两份清单
  // 并存。种一个带 marker 的原生技能，断言面 = stub 捕获的 LLM 输入**不含**
  // 该 marker（before 态：未关断时它会以 `<available_skills>` 段出现）。
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

describe('spec 14 skills 执行面注入 E2E', () => {
  test('systemPrompt 含 catalog XML（追加不覆盖）；agent read SKILL.md 结果落库（连通性硬验收）', async () => {
    world = await seedWorld(
      server.url,
      server.teamId,
      // #1106 起目录注入经选择面：任务文本点名 demo-skill（explicit-mention）
      // 才进 catalog——连通性链路（catalog→read→落库）走选中通道。
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
    // #918：activity 面订阅先行（步认领前挂上，不漏首份上报；hub 进场补发
    // 兜底晚订阅）。
    const activities = collectConvActivities(buildId);

    await waitFor(() => server.todoPhase(world.todoId) === 'review', 150_000);

    // ⑦ #918 技能事实上 activity 通道（第四形累计集）：读到的（demo-skill）
    //    与被挡下的（extra-skill，#917 门控 read 拒绝）同线在列、denied 位
    //    可区分——「被挡下的事件也要显示」的 wire 级实证。
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

    // ① catalog 注入 LLM 输入面（stub 捕获）：systemPrompt 含 <available_skills>
    //    且既有段（agent 职责文本）在位——追加而非覆盖。
    const first = stub.requests[0]!;
    const flat = JSON.stringify(first.messages);
    expect(flat).toContain('<available_skills>');
    expect(flat).toContain('<name>demo-skill</name>');
    expect(flat).toContain(skillFile); // location = 绝对路径，read 工具可直达
    expect(flat).toContain('你是集成测试 Agent');
    // 白名单外 skill 不入注入面（#372 验收一：worker 步 systemPrompt 只含
    // agent.skills 勾选条目）。
    expect(flat).not.toContain('extra-skill');

    // ② 连通性硬验收：read 工具真读到 SKILL.md——工具结果（正文 marker）
    //    经 tool relay 落库 message 面。
    const msgs = server.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.conversationId, buildId))
      .all();
    expect(JSON.stringify(msgs)).toContain(SKILL_MARKER);

    // ③ [skills] 日志行族落 daemon.log（loaded 态 + filtered 行，#372）。
    expect(logLines().some((l) => l.startsWith('[skills] loaded: 1 skills from'))).toBe(true);
    expect(logLines()).toContain('[skills] filtered: extra-skill not in agent allowlist');

    // ⑤ #917 白名单硬挡（双向证据，同一次运行）：
    //    拒侧——轮 1 的未授权 read 以 tool error 结果落库（拒绝文案带技能名），
    //    其正文 marker **不**落库；放侧 = ② 的授权 marker 落库。
    const msgsFlat = JSON.stringify(msgs);
    expect(msgsFlat).toContain('not in the agent allowlist');
    expect(msgsFlat).toContain('extra-skill');
    expect(msgsFlat).not.toContain(EXTRA_MARKER);
    // 观测行（spec 14 §裁决后的范围 5）：catalog 条数信号 + 硬挡集声明 +
    // 逐次拒绝行。
    expect(logLines().some((l) => l.startsWith('[skills] catalog: entries=1 '))).toBe(true);
    expect(logLines()).toContain('[skills] deny: 1 skill dir(s) hard-blocked');
    expect(logLines().some((l) => l.startsWith('[skills] denied-read:'))).toBe(true);
    expect(logLines().some((l) => l.includes('denied-read:') && l.includes(extraSkillFile))).toBe(
      true,
    );

    // ⑥ #917 pi 原生发现面关断（noSkills）：agentDir/skills 种入的原生技能
    //    不得出现在 LLM 输入面——重复清单收口（#958 接线实录的 before 态：
    //    两份 <available_skills> 并存）。
    expect(flat).not.toContain(PI_NATIVE_MARKER);
    expect(flat).not.toContain('native-dup');

    // ④ #958：①那条目录断言现在走的是**完全不同**的投递路径——简报不再进
    //    systemPrompt，而是落进任务 worktree 的上下文文件，由 pi 原生加载成
    //    上下文段。这里钉真 daemon 的落盘面与擦除面：写入行在位、擦除行在位、
    //    且步收尾后 worktree 里不留文件（残留会被下一次复用同一 worktree 的步
    //    的 `git add -A` 扫进提交——闸 1 的延迟污染）。
    expect(logLines().some((l) => l.includes('brief written:') && l.includes('(create)'))).toBe(
      true,
    );
    expect(logLines().some((l) => l.includes('brief removed'))).toBe(true);
    expect(existsSync(join(paths.workspacesDir, buildId, 'AGENTS.md'))).toBe(false);
  }, 150_000);
});
