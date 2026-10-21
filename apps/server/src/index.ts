// server 入口（01 §3：Hono REST + SSE + DB + git http-backend 托管 + cron +
// SPA 静态同源托管，02/A1——webDir 见 config.ts）。

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { BRAND, ENV_VARS } from '@pacman/shared';
import pino from 'pino';
import { createApp } from './app.js';
import { BUNDLED_FORM } from './bundle-form.js';
import { attachmentsDirOf, loadConfig, reposDirOf, warnInsecureBind } from './config.js';
import { openDbWithHandle } from './db/client.js';
import { seed } from './db/seed.js';
import { createKeyfileSecretBox } from './lib/secret-box.js';
import { ConversationStreamHub, TeamStreamHub } from './services/events.js';
import { killInFlightPick } from './services/fs-pick.js';
import { MachineWakeHub } from './services/machine-wake-hub.js';
import { backfillMachineConcurrency, seedLocalMachine } from './services/machines.js';
import { backfillPersonas } from './services/personas.js';
import { createScheduler } from './services/scheduler.js';
import { backfillFixedTags } from './services/tags.js';

const config = loadConfig();
const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  // pino-pretty transport 只活在 monorepo dev 形态（devDep 在盘 + thread-stream
  // worker 从 __dirname 起线程）；bundle 形态（BUNDLED_FORM，build.mjs 替换
  // 为 true，见 src/bundle-form.ts）与生产一致 = 纯 JSON 日志。
  ...(process.env.NODE_ENV === 'production' || BUNDLED_FORM
    ? {}
    : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }),
});

const { db, close } = openDbWithHandle(config.dbPath, { legacyExportDir: config.homeDir });
// keyfile 首启生成（0600）；丢失再生成 = 存量密文报废需重录（02 §8 护栏，
// README 落文档）。坏 keyfile 启动即抛，不静默降级。
const secretBox = createKeyfileSecretBox(config.keyfilePath);
const seeded = seed(db);
// 本机行启动 seed（spec 11 A8，#357）：os.hostname() 匹配已建则补 kind='local'，
// 未建则建无凭证行；idempotent——二次启动不建 duplicate。测试世界
// （test/helpers bootServer）不经本位，机器列表断言口径不变。
seedLocalMachine(db, seeded.team.id);
// 固定标签词表存量补齐（spec 15 #394 / ADR 0002 D4）：按项目幂等，二次启动
// 零动作。测试世界（bootServer）不经本位——播种单测直调 services/tags。
backfillFixedTags(db);
// persona 名册补齐（#1250 / ADR 0018 决策 0）：按团队幂等（缺谁补谁，已在位
// 的编辑保留），二次启动零动作。测试世界同 backfillFixedTags 律——直调
// services/personas。
backfillPersonas(db);
// 机器并发回填（#1241，mon 裁定）：未覆盖行跟推荐值（旧默认 3 → 推荐；
// 无指纹仍 3），手动覆盖不动；幂等，二次启动零动作。
const concurrencyBackfilled = backfillMachineConcurrency(db);
if (concurrencyBackfilled > 0) {
  logger.info(
    { machines: concurrencyBackfilled },
    'machine concurrency backfilled to recommendation',
  );
}
const hub = new TeamStreamHub();
const convHub = new ConversationStreamHub();
const machineHub = new MachineWakeHub();
const reposDir = reposDirOf(config);
mkdirSync(reposDir, { recursive: true });
const attachmentsDir = attachmentsDirOf(config);
mkdirSync(attachmentsDir, { recursive: true });
const app = createApp(
  {
    db,
    hub,
    machineHub,
    convHub,
    secretBox,
    user: seeded.user,
    team: seeded.team,
    pingIntervalMs: config.pingIntervalMs,
    claimHoldMs: config.claimHoldMs,
    uploads: new Map(),
    enrollments: new Map(),
    oauthStates: new Map(),
    oauthClient: config.githubOauth,
    reposDir,
    attachmentsDir,
    skillsDir: config.skillsDir,
    skillSourcesPath: join(config.dataDir, 'skill-sources.json'),
    webDir: config.webDir,
    authToken: config.authToken,
    mcpConfigPath: config.mcpConfigPath,
    // #1137：pino 实例进 ctx（webhook receiver 的 deliveryId 日志行；此前
    // 只喂 onError）。bootServer 测试世界不传 = 静默。
    logger,
  },
  logger,
);

// `0.0.0.0` 裸绑护栏（#251，06 册 D8）：显式全网卡绑定 + 鉴权关 → 醒目 WARN，
// 不阻断启动（风险 = 用户知情选择）。接线钉点 = test/token-auth.test.ts。
warnInsecureBind(logger, config);

// cron 定时闭环（02 §9.2 宿主自持）：启动即补扫 + tick 循环。
// deps 含 user（M2c 通知面）：定时轮停 review 经 build 漏斗发 build_review（r5 §7.2）；
// machineHub / box = #1150 CI 磨绿环轮询的 wake / token 阶梯位。
// #759 附件回收挂 tick（首 tick 即补扫，之后每小时一次；pino 直传 = GcLogger）。
// #1150 CI 磨绿环挂同家族自循环（60s 轮询 PR checks；出站读 globalThis.fetch
// ——与 AppContext.githubFetch 同源的缺省位）。
// #1406 issue 进料挂同家族自循环（5 分钟：带 ready-for-agent 的 open issue
// → D5 核打标人 → 导入 + 编排；issue 关了关卡）。opt-in（config.issueIntake，
// 默认关）：关时不传运行位，调度器不起进料循环；启动日志一行写明开关状态。
logger.info(
  { issueIntake: config.issueIntake },
  config.issueIntake
    ? `github issue intake on (${ENV_VARS.issueIntake})`
    : `github issue intake off (set ${ENV_VARS.issueIntake}=1 to enable)`,
);
const scheduler = createScheduler(
  { db, hub, machineHub, user: seeded.user, convHub, box: secretBox },
  { tickMs: config.schedulerTickMs },
  { attachmentsDir, logger },
  { githubFetch: globalThis.fetch, logger },
  config.issueIntake ? { githubFetch: globalThis.fetch, logger } : null,
);
scheduler.start();

const server = serve(
  {
    fetch: app.fetch,
    port: config.port,
    ...(config.host !== null ? { hostname: config.host } : {}),
  },
  (info) => {
    logger.info(
      { port: info.port, dataDir: config.dataDir, teamId: seeded.team.id },
      `pacman-server online — 机器注册：POST /api/teams/{id}/api-keys 取 key 后 ${BRAND.cliCommandName} start --api-key <key> --team <teamId>`,
    );
  },
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    scheduler.stop();
    // 在飞原生对话框子进程收尸（#440 S7）：osascript 挂在用户交互上，不收
    // = 逃逸孤儿（逃逸进程回归纪律，chief-process.test.ts 先例）。
    killInFlightPick();
    server.close();
    close();
    process.exit(0);
  });
}
