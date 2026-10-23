// 技能路由行为验收 E2E（#919，spec 14 §技能可见面收归 + §清单按需拉回摆）：
// 「agent 会自己路由技能」的结构判据面——目录全量、无截顶、远端分发真物化、
// 白名单硬挡双向、空清单显式信号、pi 原生发现面关断的 before/after 对照。
// 拓扑 = 真 server（团队技能库落 server skillsDir，走 #920 清单 + 按需拉
// wire）+ 真 daemon（本机 CAIRN_SKILLS_DIR 另有本地库）+ stub LLM。
// 与 skills-inject-e2e 的分工：那边钉单技能注入连通性与 #917 硬挡首证；
// 这边钉「全库多源」形态——团队分发内容真到达 agent 上下文、目录条数 =
// 白名单命中全库、空清单不静默。
//
// 失败方式清单（先于断言固化；F 编号进断言注释）：
//   F1 目录缺条：catalog entries < 白名单 ∩ 全库（点名技能缺席）——注入面
//      残缺即路由概率残缺，主判据的行为腿失去结构前提。
//   F2 截顶：全库 ≤ cap 却出现 `cap:` 行（授权条目被预算闸挤掉）。
//   F3 远端内容未物化：清单到了、字节没到——team SKILL.md 正文 marker 不落
//      库 / 物化行缺席 / 多文件技能只传 SKILL.md（引用文件缺位）。
//   F4 硬挡失效（拒侧）：未授权本地技能 read 成功、其正文 marker 落库。
//   F5 硬挡过挡（放侧）：授权技能（本机或团队分发）read 被拒。
//   F6 空清单静默：白名单空 → 无 `team-manifest-empty` 显式行（#920 口径：
//      配置事实也要出声，静默跑空 = 43 连败无人察觉的旧病）。
//   F7 空清单阻断：配置事实被当通道故障——步 failed / 会话不建。
//   F8 pi 原生清单回归：native 种植技能出现在 LLM 输入面（noSkills 关断
//      失效）；对照腿 = discoverNativeSkills 探针证明种植有效（before 面
//      真会发现它），after 面「不出现」不是空转断言。
//
// before/after 口径（票面 seam 3）：after 腿 = 本文件 F8 的活断言；before
// 腿 = F8 的 in-process 探针（同一 DefaultResourceLoader 少一个 noSkills
// 键）+ 归档红跑 docs/verify/917/before-noskills-integration-red.txt。

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

/** 团队分发（server 侧库）正文 marker：经 wire 物化后落库 = 远端字节真到达。 */
const TEAM_ALPHA_MARKER = 'TEAM-ALPHA-MARKER-919';
/** 团队技能引用文件 marker（F3 多文件腿：SKILL.md 之外也要传）。 */
const TEAM_NOTES_MARKER = 'TEAM-NOTES-MARKER-919';
/** 本机授权技能 marker（放侧）。 */
const LOCAL_ONE_MARKER = 'LOCAL-ONE-MARKER-919';
/** 本机未授权技能 marker（拒侧：此文本永不落库）。 */
const LOCAL_BLOCKED_MARKER = 'LOCAL-BLOCKED-MARKER-919';
/** pi 原生发现面种植 marker（F8：不得出现在 LLM 输入面）。 */
const NATIVE_DUP_MARKER = 'PI-NATIVE-DUP-MARKER-919';
/** 白名单全量（= 团队 3 + 本地 1；local-blocked 在外）。 */
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

/** SKILL.md fixture 写盘（frontmatter name = 目录名 = 白名单 slug，三源一致）。 */
function writeSkill(dir: string, name: string, description: string, body: string): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'SKILL.md');
  writeFileSync(file, `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`, 'utf8');
  return file;
}

/** 从 stub 捕获的首轮请求面提取 catalog 里点名技能的 location 绝对路径
 * （独立来源 = LLM 真看到的注入面，不是测试自己拼的路径）。 */
function locationOf(flat: string, name: string): string {
  const m = new RegExp(`<name>${name}</name>[\\s\\S]*?<location>([^<]+)</location>`).exec(flat);
  if (m === null) throw new Error(`catalog location not found for ${name}`);
  return m[1]!;
}

beforeAll(async () => {
  // server 侧团队技能库（#920 分发面的真值来源）：alpha 带一个引用文件
  // （多文件传输腿），beta/gamma 单文件。stub 轮次数组按引用被消费——先建
  // 数组与 onConsumed 补位，再落 fixture 路径（轮 1 的路径在 mkdtemp 后才
  // 可知，消费发生在首步运行期，晚于 beforeAll 全部写盘）。
  stubRounds = [
    // 轮 1（F4 拒侧）：read 未授权本地技能——门控 read 必须拒（文案带技能
    // 名），正文 marker 不落库。
    { toolCall: { name: 'read', arguments: { path: '<local-blocked>' } } },
    // 哨兵轮：若 onConsumed 补位失败被吃到 = 步提前收尾，断言面大声红
    // （marker 缺席），不静默不悬挂。
    { content: 'SENTINEL-EARLY-EXIT-919' },
  ];
  stub = await startStubLlm(stubRounds, {
    onConsumed: () => {
      // 首轮响应收尾的同步时刻补位后续轮——pi 收到轮 1 响应、执行工具、再发
      // 请求 2 必然晚于本回调（同 tick 内 res.end 后立即执行），无竞态。
      if (stubRounds.length !== 2) return;
      const flat = JSON.stringify(stub.requests[0]?.messages ?? []);
      const teamAlpha = locationOf(flat, 'alpha-skill');
      stubRounds.splice(
        1,
        1,
        // 轮 2（F3/F5 放侧·远端）：按 catalog location read 团队分发技能
        // ——正文 marker 落库 = 远端字节经 wire→物化→read 全链到达。
        { toolCall: { name: 'read', arguments: { path: teamAlpha } } },
        // 轮 3（F5 放侧·本机）：read 本机授权技能。
        { toolCall: { name: 'read', arguments: { path: localOneFile } } },
        // 轮 4：真做一处改动（#703 闸 2——执行步无改动过不了产物闸）。
        {
          toolCall: {
            name: 'bash',
            arguments: { command: 'printf "routing probe\\n" >> README.md' },
          },
        },
        // 轮 5：收尾。
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
  // #1169：授权白名单槽正名（原 skills 单字段拆分——ALLOWLIST 内容零变更）。
  server.db
    .update(agentTable)
    .set({ skillsAllowlist: ALLOWLIST })
    .where(eq(agentTable.id, AGENT_ID))
    .run();

  // daemon 本机库：local-one 授权、local-blocked 白名单外（硬挡对照）。
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
  // 轮 1 的拒侧路径现在才知道（mkdtemp 后）——补进已建数组（stub 按引用读）。
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
  // pi 原生发现面种植（F8 对照腿的目标物）：agentDir/skills 是 loader 默认
  // 扫描位——关断失效时它会以 <available_skills> 段回到 LLM 输入面。
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

describe('spec 14 技能路由行为验收 E2E（#919）', () => {
  test('选中目录注入 + 远端分发物化 + 白名单硬挡双向 + 原生面关断对照', async () => {
    world1 = await seedWorld(
      server.url,
      server.teamId,
      // #1106 起目录注入经选择面：任务文本点名 alpha-skill（团队面，server
      // 现扫联接描述）与 local-one（本机库——server 只见授予名，点名照选，
      // 候选基 = 授予集）——未点名条目零注入（beta/gamma 授权在但 description
      // 不进 brief）。
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

    // F1 选择收窄（#1106）：entries = 选中 2（alpha-skill 团队面 + local-one
    // 本机点名）；未点名的已授予 beta/gamma 不进注入面（description 不进
    // brief = #1106 验收 2），未授权 local-blocked 照旧不出现。
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
    // F2 无截顶：选中 2 ≤ cap 50，`cap:` 行不得出现。
    expect(logLines().some((l) => l.includes('[skills] cap:'))).toBe(false);
    expect(logLines()).toContain('[skills] filtered: local-blocked not in agent allowlist');

    // F3 远端分发真物化：清单行（3 技能 4 文件——alpha 带引用文件）+ 物化
    // 视图落盘（SKILL.md 与 notes.md 都在，字节可读）+ catalog location 指向
    // 团队视图目录（LLM 拿到的就是分发副本的绝对路径）。
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

    // F5 放侧（双腿）：团队分发正文与本机授权正文都落库——远端字节经
    // wire→物化→read 全链到达 agent 上下文。
    const msgs = server.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.conversationId, build1Id))
      .all();
    const msgsFlat = JSON.stringify(msgs);
    expect(msgsFlat).toContain(TEAM_ALPHA_MARKER);
    expect(msgsFlat).toContain(LOCAL_ONE_MARKER);

    // F4 拒侧：未授权 read 以 tool error 落库（拒绝文案带技能名），其正文
    // marker 不落库；观测行三件齐（catalog/deny/denied-read）。
    expect(msgsFlat).toContain('not in the agent allowlist');
    expect(msgsFlat).toContain('local-blocked');
    expect(msgsFlat).not.toContain(LOCAL_BLOCKED_MARKER);
    expect(logLines()).toContain('[skills] deny: 1 skill dir(s) hard-blocked');
    expect(logLines().some((l) => l.includes('denied-read:') && l.includes(localBlockedFile))).toBe(
      true,
    );

    // F8 原生面关断（before/after 同跑对照）：before 腿——探针（同一 loader
    // 少 noSkills 键）真会发现种植技能，种植有效；after 腿——LLM 输入面无
    // 该技能任何痕迹。
    const nativeDiscovered = await discoverNativeSkills({
      agentDir: paths.agentRuntimeDir,
      cwd: home,
    });
    expect(nativeDiscovered).toContain('native-dup-919');
    expect(flat).not.toContain(NATIVE_DUP_MARKER);
    expect(flat).not.toContain('native-dup-919');
  }, 180_000);

  test('空白名单：清单为空显式出声（F6），会话照常不阻断（F7）', async () => {
    // build 1 已收尾（phase=review 且 5 轮耗尽）再翻白名单——避免在跑步
    // 中途改 agent 行。
    await waitFor(() => stub.requests.length === 5, 30_000);
    // #1169：显式勾空（[]）仍是「全拒」形态——与 null（不限制）两态由
    // #1169 拆开，本测试钉的是勾空显式出声（F6）。
    server.db
      .update(agentTable)
      .set({ skillsAllowlist: [] })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    // build 2 的轮次现在补位（stub 按引用读数组；build 1 已零在跑步）。
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

    // F7：配置事实不当故障——步照常跑到 review。
    await waitFor(() => server.todoPhase(world2.todoId) === 'review', 150_000);

    // F6：空清单显式行（点名 selection 语境），且目录零注入（entries=0 也
    // 落行——「注入了多少」不靠 loaded 行反推）。
    expect(
      logLines().some(
        (l) =>
          l.startsWith('[skills] team-manifest-empty: server distributed zero skills') &&
          l.includes('selection=whitelist'),
      ),
    ).toBe(true);
    expect(logLines().some((l) => l.startsWith('[skills] catalog: entries=0 '))).toBe(true);
    // 空白名单 = 全部扫得技能进拒绝集（目录零注入纪律的对应面）。
    expect(logLines()).toContain('[skills] deny: 2 skill dir(s) hard-blocked');
    // build 2 的 LLM 输入面无 skills 段（catalog 空 → 简报不挂该节）。
    const req2 = stub.requests[5]!;
    const flat2 = JSON.stringify(req2.messages);
    expect(flat2).not.toContain('<available_skills>');
    expect(flat2).toContain('你是集成测试 Agent');
    // 会话真跑了（改动轮落库，非零会话）。
    const msgs2 = server.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.conversationId, build2Id))
      .all();
    expect(msgs2.length).toBeGreaterThan(0);
    expect(existsSync(join(paths.workspacesDir, build1Id, 'AGENTS.md'))).toBe(false);
  }, 180_000);
});
