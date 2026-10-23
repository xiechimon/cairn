// 机器面产物上传（#1134 自 machines.ts 纯提取，行为零变化）：upload-urls
// 预签名（grant → 一次性 PUT 落点）与两类落点分流——plan.md 方案版本落库
// （#1026 幂等 + #1027 入参收口）与 transcript 终稿消息行集（chief/worker
// 会话行分流）。一条生命周期（grant → PUT → parse）自持：所有权校验与
// 会话行落库复用 machines.ts journal 内核（ownedStep / publishStepStatus /
// upsertMessage / upsertChiefRow）；路由面 = routes-machine.ts 的
// upload-urls / upload 端点，一次性位 = context.ts uploads Map。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SESSION_JSONL_MAX_BYTES, type TranscriptUpload } from '@cairn/shared';
import { desc, eq } from 'drizzle-orm';
import { build, plan as planTable, step } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { NotFoundError } from './builds.js';
import {
  isChiefConversation,
  type MachineDeps,
  ownedStep,
  publishStepStatus,
  upsertChiefRow,
  upsertMessage,
} from './machines.js';

// —— upload-urls（预签名产物上传，r3 §1.6；self-host = server 自出一次性
// PUT 端点 [设计]，无对象存储）———————————————————————————————————————————————

export interface PendingUpload {
  stepId: string;
  name: string;
  machineId: string;
}

export function createUploadUrls(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
  files: { name: string }[],
  origin: string,
  uploads: Map<string, PendingUpload>,
): { uploads: { name: string; url: string; method: 'PUT'; headers: Record<string, string> }[] } {
  ownedStep(deps, machineId, stepId);
  const out = files.map((f) => {
    const uploadId = newRecordId();
    uploads.set(uploadId, { stepId, name: f.name, machineId });
    return {
      name: f.name,
      url: `${origin}/api/machine/upload/${uploadId}`,
      method: 'PUT' as const,
      headers: {},
    };
  });
  return { uploads: out };
}

/** plan.md 产物落库（M3b；02 §4.2/r5 §4「plan 即文件（plan.md），版本 =
 * 文件版本」）：每上传一版插一行 plan（version = max+1，驳回重规划轮自然
 * v2）+ build.planDocId 指向最新版（documents/{id}/diff 的 {id} 同值，
 * diff 端点面归 M4）。
 * #1027 入参校验：只接受处于规划语义的步（kind=plan 且未收尾）——此前只验
 * 机器归属，机器可对自持的 build/review 步落方案版本。非 plan kind = 400
 * （chiefStepToken「is not a … step」同族）；已收尾 = 409（恢复真路径只对
 * 仍 claimed 的步重传——recover 只返回 claimed，收尾后的迟到上传是改写
 * 历史版本面）。
 * #1026 幂等（键 = 步+内容）：「PUT 成功 / done 失败 → 恢复重传」把同一份
 * 内容再传一次时不落重复版本——最新版本就是本步同文产物时原样复用（版本/
 * 内容不动，planDocId 重指同 id = 幂等）。换步同文（驳回重规划轮照抄）不
 * 去重：版本面如实记录「新一轮规划发生过」。 */
export function receivePlanUpload(deps: MachineDeps, upload: PendingUpload, content: string): void {
  const stepRow = ownedStep(deps, upload.machineId, upload.stepId);
  if (stepRow.kind !== 'plan') {
    throw new HttpError(400, `step ${upload.stepId} is a ${stepRow.kind} step, not a plan step`);
  }
  if (stepRow.status !== 'claimed') {
    throw new HttpError(409, `step ${upload.stepId} is ${stepRow.status}, plan upload rejected`);
  }
  const buildId = stepRow.buildId;
  if (!buildId) throw new NotFoundError(`step ${upload.stepId}`);
  const last = deps.db
    .select({
      id: planTable.id,
      version: planTable.version,
      content: planTable.content,
      stepId: planTable.stepId,
    })
    .from(planTable)
    .where(eq(planTable.buildId, buildId))
    .orderBy(desc(planTable.version))
    .limit(1)
    .get();
  if (last !== undefined && last.stepId === upload.stepId && last.content === content) {
    deps.db.update(build).set({ planDocId: last.id }).where(eq(build.id, buildId)).run();
    publishStepStatus(deps, upload.stepId);
    return;
  }
  const id = newRecordId();
  deps.db
    .insert(planTable)
    .values({
      id,
      buildId,
      version: (last?.version ?? 0) + 1,
      content,
      stepId: upload.stepId,
      createdAt: nowMs(),
    })
    .run();
  deps.db.update(build).set({ planDocId: id }).where(eq(build.id, buildId)).run();
  // 落库即发会话流 step 事件（XMON-59 第二断口）：plan 行此前静默落库，web
  // ['plans', buildId] 在挂载取数读早于提交时无人再失效（方案卡停 v1/空）。
  // step 事件是既有 web 失效面（sse.ts step 分支已列 plans——message 事件与
  // plan.md 上传赛跑的兜底），把发布点从 done 收尾提前到落库点：done 面失
  // 联/延迟/重放均不吞。载荷 = 当前 step 行（stepJournalRow 单源形状）。
  publishStepStatus(deps, upload.stepId);
}

/** transcript 终稿落库（02 §1.3 数据所有权：transcript 消息/工具行经上传回传
 * 落 server DB）；id 幂等 upsert（与 tool live 行去重）。 */
export function receiveUpload(
  deps: MachineDeps,
  upload: PendingUpload,
  body: TranscriptUpload,
): void {
  ownedStep(deps, upload.machineId, upload.stepId);
  if (body.stepId !== upload.stepId) throw new NotFoundError(`upload for step ${upload.stepId}`);
  const stepRow = deps.db.select().from(step).where(eq(step.id, upload.stepId)).get();
  const conversationId = stepRow?.buildId;
  if (!conversationId) throw new NotFoundError(`step ${upload.stepId}`);
  for (const m of body.messages) {
    if (isChiefConversation(conversationId)) {
      upsertChiefRow(deps, {
        id: m.id,
        threadId: conversationId,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      });
      continue;
    }
    upsertMessage(deps, {
      id: m.id,
      conversationId,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
    });
  }
}

export function stepSessionPath(attachmentsDir: string, stepId: string): string {
  return join(attachmentsDir, 'step-sessions', `${stepId}.jsonl`);
}

export function receiveSessionUpload(
  deps: MachineDeps,
  upload: PendingUpload,
  content: string,
): void {
  ownedStep(deps, upload.machineId, upload.stepId);
  const size = Buffer.byteLength(content, 'utf8');
  if (size > SESSION_JSONL_MAX_BYTES) {
    throw new HttpError(413, `session jsonl ${size}B over ${SESSION_JSONL_MAX_BYTES}B cap`);
  }
  const dest = stepSessionPath(deps.attachmentsDir, upload.stepId);
  mkdirSync(join(deps.attachmentsDir, 'step-sessions'), { recursive: true });
  writeFileSync(dest, content, 'utf8');
}

export function readStepSession(attachmentsDir: string, stepId: string): string | null {
  const dest = stepSessionPath(attachmentsDir, stepId);
  if (!existsSync(dest)) return null;
  return readFileSync(dest, 'utf8');
}

export function getStepSession(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
): { stepId: string; content: string } {
  ownedStep(deps, machineId, stepId);
  const content = readStepSession(deps.attachmentsDir, stepId);
  if (content === null) throw new HttpError(404, 'session not found');
  return { stepId, content };
}
