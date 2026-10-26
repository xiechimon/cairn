import type { ToolCallRecord } from '@cairn/shared';
import {
  machineActivityBodySchema,
  machineAgentTodoBodySchema,
  machineAskBodySchema,
  machineClaimBodySchema,
  machineDoneBodySchema,
  machineEnrollBodySchema,
  machineEnrollConfirmBodySchema,
  machineEnrollPollBodySchema,
  machineEnrollStartBodySchema,
  machineHeartbeatBodySchema,
  machinePresenceBodySchema,
  machineShellPrecheckBodySchema,
  machineShellResultBodySchema,
  machineSyncResultBodySchema,
  machineThinkingDeltaBodySchema,
  machineToolBodySchema,
  machineToolRelayBodySchema,
  machineTranscriptDeltaBodySchema,
  machineTranscriptRowBodySchema,
  machineUploadUrlsBodySchema,
  PLAN_FILE_NAME,
  SESSION_FILE_NAME,
  transcriptUploadSchema,
} from '@cairn/shared';
import type { Context, Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AppContext } from './context.js';
import type { machine as machineTable } from './db/schema.js';
import { HttpError, parseWith } from './lib/errors.js';
import { newRecordId } from './lib/ids.js';
import { transitionBranchSync } from './services/branch-sync.js';
import { recordBuildProvenance } from './services/build-provenance.js';
import { executeRelayToolCall, machineAsk } from './services/machine-relay.js';
import { precheckShellCommand, reportShellResult } from './services/machine-shell.js';
import {
  createUploadUrls,
  getStepSession,
  receivePlanUpload,
  receiveSessionUpload,
  receiveUpload,
} from './services/machine-uploads.js';
import {
  authorizeEnrollmentMachine,
  claimStep,
  enrollMachine,
  fetchSteer,
  fetchStop,
  findApiKeyByPlain,
  findMachineByToken,
  finishStep,
  heartbeatStep,
  machineAttachmentDownload,
  machineRunningCount,
  machineSkillFile,
  machineSkillsManifest,
  markOffline,
  markPresence,
  recoverSteps,
  reportActivity,
  reportAgentTodo,
  reportThinkingDelta,
  reportTool,
  reportTranscriptDelta,
  reportTranscriptRow,
  stepToken,
  toMachineRecord,
} from './services/machines.js';

function isRelayBody(raw: unknown): boolean {
  return raw !== null && typeof raw === 'object' && 'params' in raw && !('id' in raw);
}

function isTranscriptRowBody(raw: unknown): boolean {
  return (
    raw !== null &&
    typeof raw === 'object' &&
    'kind' in raw &&
    (raw as { kind: unknown }).kind === 'transcript_row'
  );
}

function isThinkingDeltaBody(raw: unknown): boolean {
  return (
    raw !== null &&
    typeof raw === 'object' &&
    'kind' in raw &&
    (raw as { kind: unknown }).kind === 'thinking_delta'
  );
}

function isDeltaBody(raw: unknown): boolean {
  return (
    raw !== null &&
    typeof raw === 'object' &&
    'kind' in raw &&
    (raw as { kind: unknown }).kind === 'transcript_delta'
  );
}

function isActivityBody(raw: unknown): boolean {
  return (
    raw !== null &&
    typeof raw === 'object' &&
    'kind' in raw &&
    (raw as { kind: unknown }).kind === 'activity'
  );
}

function isAgentTodoBody(raw: unknown): boolean {
  return (
    raw !== null &&
    typeof raw === 'object' &&
    'kind' in raw &&
    (raw as { kind: unknown }).kind === 'agent_todo'
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
    oauthClient: ctx.oauthClient,
    ...(ctx.githubFetch !== undefined ? { githubFetch: ctx.githubFetch } : {}),
  };

  app.use('/api/machine/*', async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (path.startsWith('/api/machine/enroll')) return next();
    const token = bearer(c);
    const row = token ? findMachineByToken(ctx.db, token) : undefined;
    if (!row) throw unauthorized();
    await next();
  });

  const me = (c: Context): MachineRow => {
    const token = bearer(c);
    const row = token ? findMachineByToken(ctx.db, token) : undefined;
    if (!row) throw unauthorized();
    return row;
  };

  app.post('/api/machine/enroll', async (c) => {
    const key = bearer(c);
    const keyRow = key ? findApiKeyByPlain(ctx.db, key) : undefined;
    if (!keyRow) throw unauthorized();
    const body = parseWith(machineEnrollBodySchema, await jsonBody(c), 'body');
    if (body.teamId !== keyRow.teamId) throw unauthorized();
    const result = enrollMachine(deps, {
      keyId: keyRow.id,
      teamId: body.teamId,
      name: body.name ?? 'machine',
      ...(body.cliVersion !== undefined ? { cliVersion: body.cliVersion } : {}),
      ...(body.claudeCode !== undefined ? { claudeCode: body.claudeCode } : {}),
      ...(body.capabilities !== undefined ? { capabilities: body.capabilities } : {}),
      serverUrl: originOf(c),
    });
    return c.json(result);
  });

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

  app.get('/api/machine/me', (c) => {
    const row = me(c);
    return c.json(toMachineRecord(row, machineRunningCount(deps.db, row.id)));
  });

  app.post('/api/machine/presence', async (c) => {
    const row = me(c);
    const body = parseWith(machinePresenceBodySchema, (await jsonBody(c)) ?? {}, 'body');
    markPresence(deps, row.id, body);
    return c.json({ ok: true as const });
  });

  app.post('/api/machine/recover', (c) => {
    const row = me(c);
    return c.json({ steps: recoverSteps(deps, row.id) });
  });

  app.post('/api/machine/tasks/claim', async (c) => {
    const row = me(c);
    const body = parseWith(machineClaimBodySchema, (await jsonBody(c)) ?? {}, 'body');
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

  app.get('/api/machine/stream', (c) => {
    const row = me(c);
    return streamSSE(c, async (stream) => {
      const unsubscribe = ctx.machineHub.subscribeMachine(row.teamId, row.id, (ev) => {
        void stream.writeSSE({ data: JSON.stringify(ev) });
      });
      // undici's default 300s body timeout (measured per received chunk) silently drops an idle SSE stream.
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
        markOffline(deps, row.id);
        release();
      });
      await held;
    });
  });

  app.get('/api/machine/steer', (c) => {
    const row = me(c);
    const stepId = c.req.query('stepId');
    if (!stepId) throw new HttpError(400, 'stepId required');
    return c.json(fetchSteer({ db: ctx.db }, row, stepId));
  });

  app.get('/api/machine/stop', (c) => {
    const row = me(c);
    const stepId = c.req.query('stepId');
    if (!stepId) throw new HttpError(400, 'stepId required');
    return c.json(fetchStop({ db: ctx.db }, row, stepId));
  });

  app.post('/api/machine/heartbeat/:stepId', async (c) => {
    const row = me(c);
    const body = parseWith(machineHeartbeatBodySchema, (await jsonBody(c)) ?? {}, 'body');
    heartbeatStep(deps, row.id, c.req.param('stepId'));
    recordBuildProvenance(ctx.db, c.req.param('stepId'), body);
    return c.json({ ok: true as const });
  });

  app.post('/api/machine/tool/:stepId', async (c) => {
    const row = me(c);
    const raw = await jsonBody(c);
    if (isDeltaBody(raw)) {
      const delta = parseWith(machineTranscriptDeltaBodySchema, raw, 'body');
      reportTranscriptDelta(deps, row.id, c.req.param('stepId'), delta.text);
      return c.json({ ok: true as const });
    }
    if (isThinkingDeltaBody(raw)) {
      const delta = parseWith(machineThinkingDeltaBodySchema, raw, 'body');
      reportThinkingDelta(deps, row.id, c.req.param('stepId'), delta.text);
      return c.json({ ok: true as const });
    }
    if (isActivityBody(raw)) {
      const act = parseWith(machineActivityBodySchema, raw, 'body');
      reportActivity(deps, row.id, c.req.param('stepId'), act.activity);
      return c.json({ ok: true as const });
    }
    if (isAgentTodoBody(raw)) {
      const body = parseWith(machineAgentTodoBodySchema, raw, 'body');
      reportAgentTodo(deps, row.id, c.req.param('stepId'), body.todo);
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

  app.get('/api/machine/token/:stepId', async (c) => {
    const row = me(c);
    return c.json(await stepToken(deps, row.id, c.req.param('stepId')));
  });

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

  app.get('/api/machine/attachment/:stepId/:attachmentId', (c) => {
    const row = me(c);
    return c.json(
      machineAttachmentDownload(
        deps,
        row.id,
        row.teamId,
        c.req.param('stepId'),
        c.req.param('attachmentId'),
        c.req.query('teamId'),
      ),
    );
  });

  app.post('/api/machine/upload-urls/:stepId', async (c) => {
    const row = me(c);
    const body = parseWith(machineUploadUrlsBodySchema, await jsonBody(c), 'body');
    return c.json(
      createUploadUrls(deps, row.id, c.req.param('stepId'), body.files, originOf(c), ctx.uploads),
    );
  });

  app.put('/api/machine/upload/:uploadId', async (c) => {
    const row = me(c);
    const uploadId = c.req.param('uploadId');
    const upload = ctx.uploads.get(uploadId);
    if (!upload || upload.machineId !== row.id) throw new HttpError(404, 'upload not found');
    if (upload.name === PLAN_FILE_NAME) {
      receivePlanUpload(deps, upload, await c.req.text());
    } else if (upload.name === SESSION_FILE_NAME) {
      receiveSessionUpload(deps, upload, await c.req.text());
    } else {
      const body = parseWith(transcriptUploadSchema, await jsonBody(c), 'body');
      receiveUpload(deps, upload, body);
    }
    ctx.uploads.delete(uploadId);
    return c.json({ ok: true as const });
  });

  app.get('/api/machine/session/:stepId', (c) => {
    const row = me(c);
    return c.json(getStepSession(deps, row.id, c.req.param('stepId')));
  });

  app.post('/api/machine/done/:stepId', async (c) => {
    const row = me(c);
    const body = parseWith(machineDoneBodySchema, await jsonBody(c), 'body');
    await finishStep(deps, row.id, c.req.param('stepId'), body);
    return c.json({ ok: true as const });
  });

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

  app.post('/api/machine/shell/:stepId', async (c) => {
    const row = me(c);
    const body = parseWith(machineShellPrecheckBodySchema, await jsonBody(c), 'body');
    return c.json(precheckShellCommand(deps, row.id, c.req.param('stepId'), body));
  });

  app.post('/api/machine/shell/:runId/result', async (c) => {
    const row = me(c);
    const body = parseWith(machineShellResultBodySchema, await jsonBody(c), 'body');
    reportShellResult(deps, row.id, c.req.param('runId'), body);
    return c.json({ ok: true as const });
  });
}
