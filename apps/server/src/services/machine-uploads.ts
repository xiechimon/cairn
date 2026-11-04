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
  publishStepStatus(deps, upload.stepId);
}

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
