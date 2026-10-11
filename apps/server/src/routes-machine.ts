// 机器面路由——02 §5 canonical 13 端点（词表单源 = shared MACHINE_ENDPOINTS /
// MACHINE_WIRE；对拍测试 = test/machine-wire.test.ts）。
// 认证（02 §8）：enroll = Bearer apiKey（`pacman_<48hex>`，前缀 = 品牌槽）；其余 = Bearer 机器
// token（64hex，服务端存哈希比对）。错误形状 {error}（r5 §1 族）。
// 附加端点（[设计] 登记，非词表外扩协议面）：PUT /api/machine/upload/{uploadId}
// = upload-urls 预签名的落地点（self-host 无对象存储，server 自出一次性 PUT）；
// GET /api/machine/skills/{stepId} = 按步技能分发清单 + 同前缀 /file 单文件
// 按需拉取（XMON-109 S1，#920 清单 + 按需拉；S2 daemon 物化消费契约）。
// 全量登记表 = shared MACHINE_WIRE_EXTENSIONS。

import type { ToolCallRecord } from '@pacman/shared';
import {
  machineActivityBodySchema,
  machineAskBodySchema,
  machineClaimBodySchema,
  machineDoneBodySchema,
  machineEnrollBodySchema,
  machineEnrollConfirmBodySchema,
  machineEnrollPollBodySchema,
  machineEnrollStartBodySchema,
  machinePresenceBodySchema,
  machineShellPrecheckBodySchema,
  machineShellResultBodySchema,
  machineSyncResultBodySchema,
  machineToolBodySchema,
  machineToolRelayBodySchema,
  machineTranscriptDeltaBodySchema,
  machineTranscriptRowBodySchema,
  machineUploadUrlsBodySchema,
  PLAN_FILE_NAME,
  transcriptUploadSchema,
} from '@pacman/shared';
import type { Context, Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AppContext } from './context.js';
import type { machine as machineTable } from './db/schema.js';
import { HttpError, parseWith } from './lib/errors.js';
import { newRecordId } from './lib/ids.js';
import { transitionBranchSync } from './services/branch-sync.js';
import { createUploadUrls, receivePlanUpload, receiveUpload } from './services/machine-uploads.js';
import {
  authorizeEnrollmentMachine,
  claimStep,
  enrollMachine,
  executeRelayToolCall,
  fetchSteer,
  fetchStop,
  findApiKeyByPlain,
  findMachineByToken,
  finishStep,
  heartbeatStep,
  machineAsk,
  machineAttachmentDownload,
  machineRunningCount,
  machineSkillFile,
  machineSkillsManifest,
  markOffline,
  markPresence,
  precheckShellCommand,
  recoverSteps,
  reportActivity,
  reportShellResult,
  reportTool,
  reportTranscriptDelta,
  reportTranscriptRow,
  stepToken,
  toMachineRecord,
} from './services/machines.js';

/** relay 判别（machineToolBodySchema union 的分流位）：{name, params} 无 id =
 * remoteTools 执行；toolCallRecord（有 id/arguments）= live transcript 回传。 */
function isRelayBody(raw: unknown): boolean {
  return raw !== null && typeof raw === 'object' && 'params' in raw && !('id' in raw);
}

/** 段行判别（第五形 [设计]，#955 / ADR 0011 D2）：kind 判别位。段行是**落库
 * 形**（先落库再广播），与第三形（瞬态增量）不同径——判别必须先于 relay 的
 * 「有 params 无 id」形状判（段行有 row、无 params）。 */
function isTranscriptRowBody(raw: unknown): boolean {
  return (
    raw !== null &&
    typeof raw === 'object' &&
    'kind' in raw &&
    (raw as { kind: unknown }).kind === 'transcript_row'
  );
}

/** transcript delta 判别（第三形 [设计]，M5 live streaming）：kind 判别位。 */
function isDeltaBody(raw: unknown): boolean {
  return (
    raw !== null &&
    typeof raw === 'object' &&
    'kind' in raw &&
    (raw as { kind: unknown }).kind === 'transcript_delta'
  );
}

/** activity 判别（第四形 [设计]，#905）：kind 判别位与 delta 同族。 */
function isActivityBody(raw: unknown): boolean {
  return (
    raw !== null &&
    typeof raw === 'object' &&
    'kind' in raw &&
    (raw as { kind: unknown }).kind === 'activity'
  );
}

type MachineRow = typeof machineTable.$inferSelect;

function bearer(c: Context): string | null {
  const header = c.req.header('authorization');
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
  return value;
}

function unauthorized(): HttpError {
  return new HttpError(401, 'unauthorized');
}

async function jsonBody(c: Context): Promise<unknown> {
  return c.req.json().catch(() => null);
}

function originOf(c: Context): string {
  return new URL(c.req.url).origin;
}

export function registerMachineRoutes(app: Hono, ctx: AppContext): void {
  const deps = {
    db: ctx.db,
    hub: ctx.hub,
    machineHub: ctx.machineHub,
    box: ctx.secretBox,
    user: ctx.user,
    reposDir: ctx.reposDir,
    attachmentsDir: ctx.attachmentsDir,
    mcpConfigPath: ctx.mcpConfigPath,
    skillsDir: ctx.skillsDir,
    convHub: ctx.convHub,
    // #452 写向：set_task_meta 标题回写 + chief create_todo 自建 issue 出站位。
    ...(ctx.githubFetch !== undefined ? { githubFetch: ctx.githubFetch } : {}),
  };

  // 机器 token 认证中间件（enroll 三件除外——其认证 = apiKey）。
  app.use('/api/machine/*', async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (path.startsWith('/api/machine/enroll')) return next();
    const token = bearer(c);
    const row = token ? findMachineByToken(ctx.db, token) : undefined;
    if (!row) throw unauthorized();
    await next();
  });

  // 中间件已认证；处理器按 Bearer 重解析机器行（Hono Variables 不带型 [设计]）。
  const me = (c: Context): MachineRow => {
    const token = bearer(c);
    const row = token ? findMachineByToken(ctx.db, token) : undefined;
    if (!row) throw unauthorized();
    return row;
  };

  // —— POST /api/machine/enroll（02 §5.2 路径二：--api-key --team）—————————————
  app.post('/api/machine/enroll', async (c) => {
    const key = bearer(c);
    const keyRow = key ? findApiKeyByPlain(ctx.db, key) : undefined;
    if (!keyRow) throw unauthorized();
    const body = parseWith(machineEnrollBodySchema, await jsonBody(c), 'body');
    if (body.teamId !== keyRow.teamId) throw unauthorized();
    const result = enrollMachine(deps, {
      keyId: keyRow.id,
      teamId: body.teamId,
      name: body.name ?? 'machine', // --name 默认 hostname（客户端已带则覆盖）
      ...(body.cliVersion !== undefined ? { cliVersion: body.cliVersion } : {}),
      ...(body.claudeCode !== undefined ? { claudeCode: body.claudeCode } : {}),
      serverUrl: originOf(c),
    });
    return c.json(result); // = machine.json 形状（r3 §1.3）
  });

  // —— 浏览器授权流（02 §5.2 路径一；#285 web 接线：start/poll/confirm 三件）———————
  // enroll 位卫生 [设计]：TTL 10min + 容量上限 100（FIFO 淘汰），防无界增长。
  const ENROLL_TTL_MS = 600_000;
  const ENROLL_CAP = 100;
  app.post('/api/machine/enroll/start', async (c) => {
    const body = parseWith(machineEnrollStartBodySchema, await jsonBody(c), 'body');
    const now = Date.now();
    for (const [id, e] of ctx.enrollments) {
      if (now - e.createdAt > ENROLL_TTL_MS) ctx.enrollments.delete(id);
    }
    while (ctx.enrollments.size >= ENROLL_CAP) {
      const oldest = ctx.enrollments.keys().next().value;
      if (oldest === undefined) break;
      ctx.enrollments.delete(oldest);
    }
    const enrollId = newRecordId();
    ctx.enrollments.set(enrollId, {
      teamId: body.teamId ?? ctx.team.id,
      name: body.name,
      createdAt: now,
    });
    return c.json({
      enrollId,
      url: `${originOf(c)}/app/machines/authorize?enroll=${enrollId}`,
    });
  });

  app.post('/api/machine/enroll/poll', async (c) => {
    const body = parseWith(machineEnrollPollBodySchema, await jsonBody(c), 'body');
    const pending = ctx.enrollments.get(body.enrollId);
    if (!pending || Date.now() - pending.createdAt > ENROLL_TTL_MS) {
      return c.json({ status: 'expired' });
    }
    if (pending.machine) return c.json({ status: 'authorized', machine: pending.machine });
    return c.json({ status: 'pending' });
  });

  // 完成面（#285 [设计] MACHINE_WIRE_EXTENSIONS）：授权页用户确认——capability
  // = enrollId（无凭证面，enroll 族同 middleware 豁免）；单次（重复确认 409）。
  app.post('/api/machine/enroll/confirm', async (c) => {
    const body = parseWith(machineEnrollConfirmBodySchema, await jsonBody(c), 'body');
    const entry = ctx.enrollments.get(body.enrollId);
    if (!entry || Date.now() - entry.createdAt > ENROLL_TTL_MS) {
      throw new HttpError(404, 'enrollment unknown or expired');
    }
    if (entry.machine) throw new HttpError(409, 'enrollment already authorized');
    const machineJson = authorizeEnrollmentMachine(deps, {
      teamId: entry.teamId,
      name: entry.name ?? 'machine',
      serverUrl: originOf(c),
    });
    entry.machine = machineJson;
    return c.json({ machine: machineJson });
  });

  // —— GET /api/machine/me ————————————————————————————————————————————————————
  // #1108：maxConcurrent 随行（daemon 本地并发闸的数据源——claim 闸在
  // server，本地闸护混版本：新 daemon 对旧 server 读不到该字段按 1 串行）。
  app.get('/api/machine/me', (c) => {
    const row = me(c);
    return c.json(toMachineRecord(row, machineRunningCount(deps.db, row.id)));
  });

  // —— POST /api/machine/presence（02 §5.4 心跳）——————————————————————————————
  app.post('/api/machine/presence', async (c) => {
    const row = me(c);
    const body = parseWith(machinePresenceBodySchema, (await jsonBody(c)) ?? {}, 'body');
    markPresence(deps, row.id, body);
    return c.json({ ok: true as const });
  });

  // —— POST /api/machine/recover（步 journal 恢复 server 侧真值）———————————————
  app.post('/api/machine/recover', (c) => {
    const row = me(c);
    return c.json({ steps: recoverSteps(deps, row.id) });
  });

  // —— POST /api/machine/tasks/claim（长轮询，节奏 ~75s + wake，r3 §1.5）———————
  app.post('/api/machine/tasks/claim', async (c) => {
    const row = me(c);
    // #1148：maxWorkers 自报（daemon worker 并发上限）进 claim 闸；缺省 =
    // 老 daemon 形（body 只按机器行）。
    const body = parseWith(machineClaimBodySchema, (await jsonBody(c)) ?? {}, 'body');
    // #1065：透传请求存活态——客户端断连（daemon 被杀）时 node-server 对
    // Request signal abort，claim 面据此不替死机领步。
    const step = await claimStep(
      deps,
      row.id,
      row.teamId,
      ctx.claimHoldMs,
      originOf(c),
      c.req.raw.signal,
      body,
    );
    return c.json({ step });
  });

  // —— GET /api/machine/stream（wake SSE，02 §1.2/§5.4）———————————————————————
  app.get('/api/machine/stream', (c) => {
    const row = me(c);
    return streamSSE(c, async (stream) => {
      // 机器定向订阅（M7 #319 [设计]，08 册附录 B）：team 广播 + 机器索引，
      // 供 pushSync 派发 sync 命令到本机。重复连接 = 后注册覆盖前注册（重连
      // 中间态自动清理）。
      const unsubscribe = ctx.machineHub.subscribeMachine(row.teamId, row.id, (ev) => {
        void stream.writeSSE({ data: JSON.stringify(ev) });
      });
      // #863 机器通道保活：无事件机器的流零字节输出，客户端侧 bodyTimeout
      // （undici 默认 300s 按 body 数据间隔计）会把 SSE 静默掐断 → onAbort
      // markOffline → online 闪断到下一次 presence（≤30s）。会话亲和闸（#
      // 863 tryClaim）按 online 即时判会话机在位与否，闪断窗口内会把他机
      // 误放行 = 无谓换机（machine-execution-plane §4-7 会话丢失）。修法 =
      // team/conv 通道同节奏（ctx.pingIntervalMs）的 SSE 注释帧保活；注释行
      // （`:` 前缀）是 SSE 规范的 keep-alive 形态，daemon 帧解析只认 `data:`
      // 前缀行（machine-client.ts），注释行零解析面、零 wire 契约变化。
      const pingTimer = setInterval(() => {
        void stream.write(': ping\n\n').catch(() => {});
      }, ctx.pingIntervalMs);
      let release: () => void = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      stream.onAbort(() => {
        clearInterval(pingTimer);
        unsubscribe();
        // 推送通道断 = 机器下线 [设计]（daemon 停机即断连；重连窗口内
        // presence 会重新置 online）。
        markOffline(deps, row.id);
        release();
      });
      await held;
    });
  });

  // —— GET /api/machine/steer?stepId=（W3 #278 [设计] 登记位：
  // MACHINE_WIRE_EXTENSIONS；steer 拉取-确认——本机在跑步才可拉取，拉取即清）。
  app.get('/api/machine/steer', (c) => {
    const row = me(c);
    const stepId = c.req.query('stepId');
    if (!stepId) throw new HttpError(400, 'stepId required');
    return c.json(fetchSteer({ db: ctx.db }, row, stepId));
  });

  // —— GET /api/machine/stop?stepId=（M7 #308 [设计] 登记位：
  // MACHINE_WIRE_EXTENSIONS；stop 拉取-确认——本机在跑步才可拉取，拉取即清）。
  app.get('/api/machine/stop', (c) => {
    const row = me(c);
    const stepId = c.req.query('stepId');
    if (!stepId) throw new HttpError(400, 'stepId required');
    return c.json(fetchStop({ db: ctx.db }, row, stepId));
  });

  // —— POST /api/machine/heartbeat/{stepId} ———————————————————————————————————
  app.post('/api/machine/heartbeat/:stepId', (c) => {
    const row = me(c);
    heartbeatStep(deps, row.id, c.req.param('stepId'));
    return c.json({ ok: true as const });
  });

  // —— POST /api/machine/tool/{stepId}（同径双形，r5 §3.1 bundle 提取；增量
  // 第三形 transcript delta [设计]、第四形 activity [#905]、第五形 transcript
  // row [#955/ADR 0011]）：
  // ① remoteTools relay 执行 {name, params} → {text}（chief 步服务端工具）；
  // ② live transcript 工具行回传 toolCallRecord → {ok:true}（worker 步内建工具）。
  // 分流判别：kind = delta/activity；有 params 无 id = relay（machineToolBodySchema union）。———
  app.post('/api/machine/tool/:stepId', async (c) => {
    const row = me(c);
    const raw = await jsonBody(c);
    if (isDeltaBody(raw)) {
      const delta = parseWith(machineTranscriptDeltaBodySchema, raw, 'body');
      reportTranscriptDelta(deps, row.id, c.req.param('stepId'), delta.text);
      return c.json({ ok: true as const });
    }
    if (isActivityBody(raw)) {
      const act = parseWith(machineActivityBodySchema, raw, 'body');
      reportActivity(deps, row.id, c.req.param('stepId'), act.activity);
      return c.json({ ok: true as const });
    }
    if (isTranscriptRowBody(raw)) {
      const seg = parseWith(machineTranscriptRowBodySchema, raw, 'body');
      reportTranscriptRow(deps, row.id, c.req.param('stepId'), seg.row);
      return c.json({ ok: true as const });
    }
    if (isRelayBody(raw)) {
      const relay = parseWith(machineToolRelayBodySchema, raw, 'body');
      const text = await executeRelayToolCall(
        deps,
        row.id,
        c.req.param('stepId'),
        relay.name,
        relay.params,
      );
      return c.json({ text });
    }
    const body = parseWith(machineToolBodySchema, raw, 'body');
    reportTool(deps, row.id, c.req.param('stepId'), body as ToolCallRecord);
    return c.json({ ok: true as const });
  });

  // —— POST /api/machine/ask/{stepId}（#1049 结构化问答阻塞通道，MACHINE_WIRE_
  // EXTENSIONS 登记位）：{requestId, questions} → {status, requestId, answers,
  // reason}。hold 长轮询（默认 ~70s；?holdMs= 测试注入，上限同默认）——到期
  // 仍 pending，daemon 原样重发（requestId 幂等，D4 重投不叠卡）。signal =
  // 请求断连（#1065 僵尸语义同律）。
  app.post('/api/machine/ask/:stepId', async (c) => {
    const row = me(c);
    const body = parseWith(machineAskBodySchema, await jsonBody(c), 'body');
    const rawHold = Number(c.req.query('holdMs'));
    const holdMs = Number.isFinite(rawHold) && rawHold >= 0 ? Math.min(rawHold, 70_000) : 70_000;
    return c.json(
      await machineAsk(deps, row.id, c.req.param('stepId'), body, {
        holdMs,
        signal: c.req.raw.signal,
      }),
    );
  });

  // —— GET /api/machine/token/{stepId}（per-step 凭证下发，02 §8）——————————————
  app.get('/api/machine/token/:stepId', (c) => {
    const row = me(c);
    return c.json(stepToken(deps, row.id, c.req.param('stepId')));
  });

  // —— GET /api/machine/skills/{stepId}（XMON-109 S1 [设计] 附加端点，
  // MACHINE_WIRE_EXTENSIONS 登记位；#920 改清单 + 按需拉）：按步技能分发
  // 清单（S2 daemon 物化消费契约）——worker 步 = agent.skills 白名单交集
  // （selection='whitelist'）、chief 步 = 信任面全量（selection='all'）；
  // 每文件 path/sizeBytes/sha256，本体走下方 /file 端点。非本步凭证/未知步
  // = 404（ownedStep 同 token 面）。
  // —— GET /api/machine/skills/{stepId}/file?dirName=&path=（#920 [设计]
  // 登记位）：清单内单文件原始字节（application/octet-stream，二进制诚实
  // 下发）；白名单外/清单外/逃逸形 = 404 不泄存在性。 ————————————————
  app.get('/api/machine/skills/:stepId', (c) => {
    const row = me(c);
    return c.json(machineSkillsManifest(deps, row.id, c.req.param('stepId')));
  });
  app.get('/api/machine/skills/:stepId/file', (c) => {
    const row = me(c);
    const bytes = machineSkillFile(
      deps,
      row.id,
      c.req.param('stepId'),
      c.req.query('dirName') ?? '',
      c.req.query('path') ?? '',
    );
    return c.body(new Uint8Array(bytes), 200, {
      'content-type': 'application/octet-stream',
      'content-length': String(bytes.length),
    });
  });

  // —— GET /api/machine/attachment/{stepId}/{attachmentId}（#730 [设计]
  // 登记位 MACHINE_WIRE_EXTENSIONS）：daemon 侧图片附件下载——machine token
  // 认证（/api/machine/* 中间件）+ ownedStep（本机步）+ 附件 team 归属（跨
  // team 404）+ ready 闸（pending/failed 409）。浏览器 session 面
  // GET /api/attachments/:id 零改动（两条通道独立并存）。 ——————————————
  app.get('/api/machine/attachment/:stepId/:attachmentId', (c) => {
    const row = me(c);
    return c.json(
      machineAttachmentDownload(
        deps,
        row.id,
        row.teamId,
        c.req.param('stepId'),
        c.req.param('attachmentId'),
      ),
    );
  });

  // —— POST /api/machine/upload-urls/{stepId}（预签名产物上传）—————————————————
  app.post('/api/machine/upload-urls/:stepId', async (c) => {
    const row = me(c);
    const body = parseWith(machineUploadUrlsBodySchema, await jsonBody(c), 'body');
    return c.json(
      createUploadUrls(deps, row.id, c.req.param('stepId'), body.files, originOf(c), ctx.uploads),
    );
  });

  // —— PUT /api/machine/upload/{uploadId}（[设计] 预签名落地点；按登记 name
  // 分流：transcript.json = 终稿消息行集、plan.md = 方案文件版本，02 §1.3/§4.2）——
  app.put('/api/machine/upload/:uploadId', async (c) => {
    const row = me(c);
    const uploadId = c.req.param('uploadId');
    const upload = ctx.uploads.get(uploadId);
    if (!upload || upload.machineId !== row.id) throw new HttpError(404, 'upload not found');
    if (upload.name === PLAN_FILE_NAME) {
      receivePlanUpload(deps, upload, await c.req.text());
    } else {
      const body = parseWith(transcriptUploadSchema, await jsonBody(c), 'body');
      receiveUpload(deps, upload, body);
    }
    ctx.uploads.delete(uploadId); // 一次性
    return c.json({ ok: true as const });
  });

  // —— POST /api/machine/done/{stepId}（收尾 + phase 推进 + 记账 + 合并落地）———
  app.post('/api/machine/done/:stepId', async (c) => {
    const row = me(c);
    const body = parseWith(machineDoneBodySchema, await jsonBody(c), 'body');
    await finishStep(deps, row.id, c.req.param('stepId'), body);
    return c.json({ ok: true as const });
  });

  // —— POST /api/machine/sync-result/{syncId}（M7 #319 [设计]，
  // MACHINE_WIRE_EXTENSIONS 登记位，08 册附录 B「分支同步」）：daemon 回写
  // sync 状态过渡（running/synced/failed）。状态机 = pending → running →
  // synced/failed——终态不可改、跨机写入校验 machineId 归属（403）。transition
  // 内部 publish team stream `branch_sync` 事件，web 实时结果卡数据面单源
  // （services/branch-sync.ts transitionBranchSync）。 ————————————————
  app.post('/api/machine/sync-result/:syncId', async (c) => {
    const row = me(c);
    const body = parseWith(machineSyncResultBodySchema, await jsonBody(c), 'body');
    transitionBranchSync(
      { db: ctx.db, hub: ctx.hub },
      {
        syncId: c.req.param('syncId'),
        machineId: row.id,
        status: body.status,
        ...(body.errorMessage !== undefined ? { errorMessage: body.errorMessage } : {}),
      },
    );
    return c.json({ ok: true as const });
  });

  // —— POST /api/machine/shell/{stepId}（XMON-108 R1，MACHINE_WIRE_EXTENSIONS
  // 登记位）：远程 shell 每命令预检——双闸（agent「远程 shell」开关 ∩
  // machine.shellEnabled）每调用重读 + 审计行先于放行落库。2xx ⇔ allowed
  // （响应 {allowed:true, runId}）；拒绝 = 403 {error: 原因}（denied 审计行
  // 已落库）。服务层 = services/machines.ts precheckShellCommand。 ——————————
  app.post('/api/machine/shell/:stepId', async (c) => {
    const row = me(c);
    const body = parseWith(machineShellPrecheckBodySchema, await jsonBody(c), 'body');
    return c.json(precheckShellCommand(deps, row.id, c.req.param('stepId'), body));
  });

  // —— POST /api/machine/shell/{runId}/result（XMON-108 R1，MACHINE_WIRE
  // EXTENSIONS 登记位）：daemon 按预检下发的 runId 回写执行终态
  // （done/failed；running → 终态只写一次，重复回写幂等 200）。跨机回写 = 403
  // （sync-result 同律）。服务层 = reportShellResult。 ——————————————————————
  app.post('/api/machine/shell/:runId/result', async (c) => {
    const row = me(c);
    const body = parseWith(machineShellResultBodySchema, await jsonBody(c), 'body');
    reportShellResult(deps, row.id, c.req.param('runId'), body);
    return c.json({ ok: true as const });
  });
}
