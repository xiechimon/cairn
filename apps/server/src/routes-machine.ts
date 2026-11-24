import { randomBytes } from 'node:crypto';
import type { ToolCallRecord } from '@cairn/shared';
import {
  claudeRateLimitReportSchema,
  computerCallIdSchema,
  enrollDisplayName,
  MACHINE_ENROLL_TTL_MS,
  machineActivityBodySchema,
  machineAgentTodoBodySchema,
  machineAntigravityModelProbeBodySchema,
  machineAntigravityVerifyBodySchema,
  machineAskBodySchema,
  machineBackgroundTaskBodySchema,
  machineClaimBodySchema,
  machineClosedOrbsBodySchema,
  machineComputerFramesBodySchema,
  machineComputerRelayBodySchema,
  machineDoneBodySchema,
  machineEnrollBodySchema,
  machineEnrollConfirmBodySchema,
  machineEnrollPollBodySchema,
  machineEnrollStartBodySchema,
  machineHeartbeatBodySchema,
  machineImEventBodySchema,
  machineLocalMergeRecheckBodySchema,
  machineOfflineBodySchema,
  machinePresenceBodySchema,
  machineSteerAckBodySchema,
  machineThinkingDeltaBodySchema,
  machineToolBodySchema,
  machineToolRelayBodySchema,
  machineTranscriptDeltaBodySchema,
  machineTranscriptRowBodySchema,
  machineUploadUrlsBodySchema,
  normalizeEnrollCode,
  PLAN_FILE_NAME,
  REPO_ARCHIVE_FAILED_FILE_NAME,
  REPO_ARCHIVE_FILE_NAME,
  SESSION_FILE_NAME,
  transcriptUploadSchema,
} from '@cairn/shared';
import { and, eq, inArray, isNotNull, or } from 'drizzle-orm';
import type { Context, Hono } from 'hono';
import type { AppContext } from './context.js';
import { build, type machine as machineTable, step, todo } from './db/schema.js';
import { HttpError, parseWith } from './lib/errors.js';
import { forwardedOrigin } from './lib/forwarded-origin.js';
import { newRecordId } from './lib/ids.js';
import { isDirectLoopbackPeer, isLoopbackPeer } from './lib/request-origin.js';
import { openSseStream } from './lib/sse-headers.js';
import { tailnetOriginOf } from './lib/tailnet-listener.js';
import { pairedDeviceIdOf } from './lib/token-auth.js';
import { githubAppOf, jsonBody } from './routes-helpers.js';
import {
  claimAntigravityModelProbe,
  finishAntigravityModelProbe,
} from './services/antigravity-model-probes.js';
import { recordBuildProvenance } from './services/build-provenance.js';
import { recordClaudeRateLimit } from './services/claude-rate-limit.js';
import { hasActiveDevinSubscription } from './services/devin-subscriptions.js';
import { localMergeRecheckAuthorization } from './services/local-merge.js';
import { receiveAntigravityVerify } from './services/machine-antigravity-verify.js';
import { scopeMachineClaim } from './services/machine-claim-scope.js';
import { forwardComputerCall, receiveComputerFrames } from './services/machine-computer.js';
import { withFencedTransaction } from './services/machine-deps.js';
import { executeRelayToolCall, machineAsk } from './services/machine-relay.js';
import { receiveRepoArchive, receiveRepoArchiveFailure } from './services/machine-repo-archive.js';
import {
  createUploadUrls,
  getStepSession,
  type PendingUpload,
  receivePlanUpload,
  receiveSessionUpload,
  receiveUpload,
} from './services/machine-uploads.js';
import {
  ackSteer,
  authorizeEnrollmentMachine,
  claimStep,
  enrollMachine,
  fetchSteer,
  fetchStop,
  findApiKeyByPlain,
  findMachineByToken,
  finishStep,
  heartbeatStep,
  localEnrollmentRefusal,
  machineAttachmentDownload,
  machineRunningCount,
  machineSkillFile,
  machineSkillsManifest,
  markConnected,
  markOffline,
  markPresence,
  recoverSteps,
  reportActivity,
  reportAgentTodo,
  reportBackgroundTask,
  reportThinkingDelta,
  reportTool,
  reportTranscriptDelta,
  reportTranscriptRow,
  stepToken,
  toMachineRecord,
} from './services/machines.js';
import { phoneRowsForPresence } from './services/phone-computer.js';
import { resumeRuntimeHeldBuilds } from './services/runtime-holds.js';

function isComputerRelayBody(raw: unknown): boolean {
  return raw !== null && typeof raw === 'object' && 'computer' in raw && raw.computer === true;
}

function isRelayBody(raw: unknown): boolean {
  return raw !== null && typeof raw === 'object' && 'params' in raw && !('id' in raw);
}

function isBackgroundTaskBody(raw: unknown): boolean {
  return (
    raw !== null &&
    typeof raw === 'object' &&
    'kind' in raw &&
    (raw as { kind: unknown }).kind === 'bg_task'
  );
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

const MACHINE_UPLOAD_PATH = '/api/machine/upload/:uploadId';

declare module 'hono' {
  interface ContextVariableMap {
    authenticatedMachineId: string;
    machineUpload: PendingUpload;
  }
}

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

const ENROLL_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newEnrollCode(taken: ReadonlySet<string>): string {
  for (;;) {
    const bytes = randomBytes(8);
    const code = [...bytes].map((b) => ENROLL_CODE_ALPHABET[b & 31]).join('');
    if (!taken.has(code)) return code;
  }
}

function enrollOrigin(c: Context): string {
  const configured = process.env.CAIRN_WEB_ORIGIN?.trim();
  if (configured !== undefined && configured !== '') {
    try {
      return new URL(configured).origin;
    } catch {}
  }
  return originOf(c);
}

function originOf(c: Context): string {
  return (
    tailnetOriginOf(c) ??
    forwardedOrigin({
      url: c.req.url,
      loopbackPeer: isLoopbackPeer(c),
      proto: c.req.header('x-forwarded-proto'),
      host: c.req.header('x-forwarded-host'),
    })
  );
}

export function registerMachineAuth(app: Hono, ctx: Pick<AppContext, 'db' | 'uploads'>): void {
  app.use('/api/machine/*', async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (path.startsWith('/api/machine/enroll')) return next();
    const token = bearer(c);
    if (!token) throw unauthorized();
    const row = findMachineByToken(ctx.db, token);
    if (!row) throw unauthorized();
    c.set('authenticatedMachineId', row.id);
    await next();
    if (findMachineByToken(ctx.db, token)?.id !== row.id) throw unauthorized();
  });

  app.use(MACHINE_UPLOAD_PATH, async (c, next) => {
    if (c.req.method !== 'PUT') return next();
    const upload = ctx.uploads.get(c.req.param('uploadId'));
    if (upload === undefined || upload.machineId !== c.get('authenticatedMachineId')) {
      throw new HttpError(404, 'upload not found');
    }
    c.set('machineUpload', upload);
    await next();
  });
}

export function registerMachineRoutes(app: Hono, ctx: AppContext): void {
  const deps = {
    ...githubAppOf(ctx),
    db: ctx.db,
    hub: ctx.hub,
    machineHub: ctx.machineHub,
    box: ctx.secretBox,
    user: ctx.user,
    vapidKeys: ctx.vapidKeys,
    reposDir: ctx.reposDir,
    attachmentsDir: ctx.attachmentsDir,
    mcpConfigPath: ctx.mcpConfigPath,
    skillsDir: ctx.skillsDir,
    convHub: ctx.convHub,
    oauthClient: ctx.oauthClient,
    ...(ctx.mcpGithubApp !== undefined ? { githubApp: ctx.mcpGithubApp } : {}),
    ...(ctx.githubFetch !== undefined ? { githubFetch: ctx.githubFetch } : {}),
    ...(ctx.githubBaseFetch !== undefined ? { githubBaseFetch: ctx.githubBaseFetch } : {}),
    ...(ctx.oauthFetch !== undefined ? { oauthFetch: ctx.oauthFetch } : {}),
    ...(ctx.mcpFetch !== undefined ? { mcpFetch: ctx.mcpFetch } : {}),
    ...(ctx.mailSend !== undefined ? { mailSend: ctx.mailSend } : {}),
    mcpOAuthState: ctx.mcpOAuthState,
  };

  const me = (c: Context): MachineRow => {
    const token = bearer(c);
    const row = token ? findMachineByToken(ctx.db, token) : undefined;
    if (!row) throw unauthorized();
    return row;
  };

  const generationOf = (c: Context): number | undefined => {
    const raw = c.req.query('generation');
    const generation = raw !== undefined && /^\d{1,20}$/.test(raw) ? Number(raw) : undefined;
    return Number.isSafeInteger(generation) ? generation : undefined;
  };
  const claimDeps = (c: Context, row: MachineRow, stepId = c.req.param('stepId') ?? '') => {
    if (c.req.path.startsWith('/api/machine/heartbeat/')) {
      const current = ctx.db.select().from(step).where(eq(step.id, stepId)).get();
      if (current === undefined) throw new HttpError(410, `step ${stepId} no longer exists`);
      if (current.status !== 'claimed') throw new HttpError(404, `step ${stepId} is not claimed`);
    }
    return scopeMachineClaim(deps, {
      machineId: row.id,
      stepId,
      generation: generationOf(c),
      tokenHash: row.tokenHash,
    });
  };

  const executeMachineCommand = async <T, R>(
    c: Context,
    read: () => Promise<T>,
    execute: (row: MachineRow, body: T) => R,
  ) => {
    const token = bearer(c) ?? '';
    const row = me(c);
    const body = await read();
    if (findMachineByToken(ctx.db, token)?.id !== row.id) throw unauthorized();
    return await execute(row, body);
  };

  app.post('/api/machine/enroll', async (c) => {
    const key = bearer(c);
    const keyRow = key ? findApiKeyByPlain(ctx.db, key) : undefined;
    if (!keyRow) throw unauthorized();
    if (!keyRow.machineAccess) throw new HttpError(403, 'api key cannot enroll machines');
    const body = parseWith(machineEnrollBodySchema, await jsonBody(c), 'body');
    if (body.teamId !== keyRow.teamId) throw unauthorized();
    const result = enrollMachine(deps, {
      keyId: keyRow.id,
      teamId: body.teamId,
      name: body.name ?? 'machine',
      ...(body.cliVersion !== undefined ? { cliVersion: body.cliVersion } : {}),
      ...(body.claudeCode !== undefined ? { claudeCode: body.claudeCode } : {}),
      ...(body.capabilities !== undefined ? { capabilities: body.capabilities } : {}),
      ...(body.hostKey !== undefined ? { hostKey: body.hostKey } : {}),
      ...(body.legacyHostKeys !== undefined ? { legacyHostKeys: body.legacyHostKeys } : {}),
      serverUrl: originOf(c),
    });
    if (body.claudeCode !== undefined) await resumeRuntimeHeldBuilds(deps, body.teamId);
    return c.json(result);
  });

  const ENROLL_CAP = 100;
  app.post('/api/machine/enroll/start', async (c) => {
    const body = parseWith(machineEnrollStartBodySchema, await jsonBody(c), 'body');
    const fromLocalHost = isDirectLoopbackPeer(c);
    const refusal = localEnrollmentRefusal(ctx.db, {
      teamId: body.teamId ?? ctx.team.id,
      name: body.name,
      hostKey: body.hostKey,
      ...(body.legacyHostKeys !== undefined ? { legacyHostKeys: body.legacyHostKeys } : {}),
      fromLocalHost,
    });
    if (refusal !== null) throw new HttpError(409, refusal);
    const now = Date.now();
    for (const [id, e] of ctx.enrollments) {
      if (now - e.createdAt > MACHINE_ENROLL_TTL_MS) ctx.enrollments.delete(id);
    }
    while (ctx.enrollments.size >= ENROLL_CAP) {
      const oldest = ctx.enrollments.keys().next().value;
      if (oldest === undefined) break;
      ctx.enrollments.delete(oldest);
    }
    const enrollId = newRecordId();
    const code = newEnrollCode(new Set([...ctx.enrollments.values()].map((e) => e.code)));
    ctx.enrollments.set(enrollId, {
      teamId: body.teamId ?? ctx.team.id,
      name: body.name,
      code,
      createdAt: now,
      fromLocalHost,
      ...(body.hostKey !== undefined ? { hostKey: body.hostKey } : {}),
      ...(body.legacyHostKeys !== undefined ? { legacyHostKeys: body.legacyHostKeys } : {}),
    });
    return c.json({
      enrollId,
      url: `${enrollOrigin(c)}/app/machines/authorize?enroll=${enrollId}`,
      code: `${code.slice(0, 4)}-${code.slice(4)}`,
    });
  });

  app.post('/api/machine/enroll/poll', async (c) => {
    const body = parseWith(machineEnrollPollBodySchema, await jsonBody(c), 'body');
    const pending = ctx.enrollments.get(body.enrollId);
    if (!pending || Date.now() - pending.createdAt > MACHINE_ENROLL_TTL_MS) {
      return c.json({ status: 'expired' });
    }
    if (pending.machine) return c.json({ status: 'authorized', machine: pending.machine });
    const name = enrollDisplayName(pending.name);
    return c.json({ status: 'pending', ...(name !== undefined ? { name } : {}) });
  });

  app.post('/api/machine/enroll/confirm', async (c) => {
    const body = parseWith(machineEnrollConfirmBodySchema, await jsonBody(c), 'body');
    const entry =
      'enrollId' in body
        ? ctx.enrollments.get(body.enrollId)
        : [...ctx.enrollments.values()].find((e) => e.code === normalizeEnrollCode(body.code));
    if (!entry || Date.now() - entry.createdAt > MACHINE_ENROLL_TTL_MS) {
      throw new HttpError(404, 'enrollment unknown or expired');
    }
    if (entry.machine) throw new HttpError(409, 'enrollment already authorized');
    if (entry.teamId !== ctx.team.id) {
      throw new HttpError(403, 'enrollment team mismatch');
    }
    const machineJson = authorizeEnrollmentMachine(deps, {
      teamId: entry.teamId,
      name: entry.name ?? 'machine',
      serverUrl: originOf(c),
      ownerApproved: pairedDeviceIdOf(c) === null,
      fromLocalHost: entry.fromLocalHost === true,
      ...(entry.hostKey !== undefined ? { hostKey: entry.hostKey } : {}),
      ...(entry.legacyHostKeys !== undefined ? { legacyHostKeys: entry.legacyHostKeys } : {}),
      ...(body.retireToken !== undefined ? { retireToken: body.retireToken } : {}),
    });
    entry.machine = machineJson;
    return c.json({ machine: machineJson });
  });

  app.get('/api/machine/me', (c) => {
    const row = me(c);
    return c.json(toMachineRecord(row, machineRunningCount(deps.db, row.id)));
  });

  app.post('/api/machine/orbs/closed', async (c) => {
    return executeMachineCommand(
      c,
      () => jsonBody(c),
      async (row, decoded) => {
        const body = parseWith(machineClosedOrbsBodySchema, decoded, 'body');
        if (body.conversationIds.length === 0) return c.json([]);
        const closed = ctx.db
          .selectDistinct({ id: build.id })
          .from(build)
          .innerJoin(todo, eq(todo.id, build.todoId))
          .innerJoin(step, eq(step.buildId, build.id))
          .where(
            and(
              inArray(build.id, body.conversationIds),
              eq(step.machineId, row.id),
              eq(todo.teamId, row.teamId),
              or(inArray(todo.phase, ['closed', 'done']), isNotNull(todo.archivedAt)),
            ),
          )
          .all();
        return c.json(closed.map((conversation) => conversation.id));
      },
    );
  });

  app.post('/api/machine/presence', async (c) => {
    return executeMachineCommand(
      c,
      () => jsonBody(c),
      async (row, decoded) => {
        const body = parseWith(machinePresenceBodySchema, decoded ?? {}, 'body');
        const admission = ctx.machineHub.admitPresence(row.id, body.connectionId);
        if (admission !== 'ignore') {
          markPresence(deps, row.id, body, admission === 'online');
          if (body.claudeCode !== undefined) await resumeRuntimeHeldBuilds(deps, row.teamId);
        }
        const phones = phoneRowsForPresence(ctx.db, row.id);
        return c.json({
          ok: true as const,
          ...(hasActiveDevinSubscription(deps, row.teamId) ? { installDevin: true } : {}),
          ...(phones.length > 0 ? { phones } : {}),
        });
      },
    );
  });

  app.post('/api/machine/offline', async (c) => {
    return executeMachineCommand(
      c,
      () => jsonBody(c),
      async (row, decoded) => {
        const body = parseWith(machineOfflineBodySchema, decoded ?? {}, 'body');
        const applied = ctx.machineHub.endConnection(row.id, body.connectionId);
        if (applied) markOffline(deps, row.id);
        return c.json({ applied });
      },
    );
  });

  app.post('/api/machine/rate-limit', async (c) => {
    return executeMachineCommand(
      c,
      () => jsonBody(c),
      async (row, decoded) => {
        const body = parseWith(claudeRateLimitReportSchema, decoded ?? {}, 'body');
        if (body.machineId !== row.id)
          throw new HttpError(403, 'rate limit event is for another machine');
        recordClaudeRateLimit(deps, row, body);
        return c.json({ ok: true as const });
      },
    );
  });

  app.post('/api/machine/recover', (c) => {
    const row = me(c);
    return c.json({ steps: recoverSteps(deps, row.id) });
  });

  app.post('/api/machine/tasks/claim', async (c) => {
    return executeMachineCommand(
      c,
      () => jsonBody(c),
      async (row, decoded) => {
        const body = parseWith(machineClaimBodySchema, decoded ?? {}, 'body');
        const token = bearer(c) ?? '';
        const stillAuthorized = () => findMachineByToken(ctx.db, token)?.id === row.id;
        const step = await claimStep(
          deps,
          row.id,
          row.teamId,
          ctx.claimHoldMs,
          originOf(c),
          c.req.raw.signal,
          body,
          stillAuthorized,
        );
        if (!stillAuthorized()) throw unauthorized();
        return c.json({ step });
      },
    );
  });

  app.get('/api/machine/stream', (c) => {
    const row = me(c);
    const token = bearer(c) ?? '';
    return openSseStream(c, async (stream) => {
      let lastWrite: Promise<unknown> = Promise.resolve();
      const unsubscribe = ctx.machineHub.subscribeMachine(
        row.teamId,
        row.id,
        (ev) => {
          lastWrite = stream.writeSSE({ data: JSON.stringify(ev) }).catch(() => {});
        },
        () => {
          void lastWrite.then(() => release());
        },
      );
      const connectionId = ctx.machineHub.connectionId(row.id) ?? '';
      markConnected(deps, row.id);
      lastWrite = stream
        .writeSSE({ data: JSON.stringify({ type: 'hello', connectionId }) })
        .catch(() => {});
      const pingTimer = setInterval(() => {
        if (findMachineByToken(ctx.db, token)?.id !== row.id) {
          if (ctx.machineHub.endConnection(row.id, connectionId)) markOffline(deps, row.id);
          release();
          return;
        }
        void stream.write(': ping\n\n').catch(() => {});
      }, ctx.pingIntervalMs);
      let release: () => void = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      stream.onAbort(() => {
        ctx.machineHub.dropConnection(row.id, connectionId, () => markOffline(deps, row.id));
        release();
      });
      await held;
      clearInterval(pingTimer);
      unsubscribe();
    });
  });

  app.post('/api/machine/antigravity/model-probes/:requestId', async (c) => {
    const requestId = c.req.param('requestId');
    return executeMachineCommand(
      c,
      () => jsonBody(c),
      (row, decoded) => {
        const body = parseWith(machineAntigravityModelProbeBodySchema, decoded, 'body');
        if (body.phase === 'claim') {
          const token = claimAntigravityModelProbe(
            ctx.machineHub,
            requestId,
            row.id,
            body.connectionId,
          );
          if (token === undefined) throw new HttpError(404, 'Model probe not found');
          return c.json({ token }, 200, { 'Cache-Control': 'no-store' });
        }
        const accepted = finishAntigravityModelProbe(
          ctx.machineHub,
          requestId,
          row.id,
          body.connectionId,
          body.result,
        );
        if (accepted === 'not-found') throw new HttpError(404, 'Model probe not found');
        if (accepted === 'revoked') {
          throw new HttpError(409, 'Model probe authorization changed after claim', undefined, {
            code: 'probe-authorization-changed',
          });
        }
        return c.json({ ok: true as const });
      },
    );
  });

  app.post('/api/machine/antigravity/verify', async (c) => {
    return executeMachineCommand(
      c,
      () => jsonBody(c),
      async (row, decoded) => {
        const body = parseWith(machineAntigravityVerifyBodySchema, decoded ?? {}, 'body');
        receiveAntigravityVerify(deps, row.id, body);
        return c.json({ ok: true as const });
      },
    );
  });

  app.get('/api/machine/steer', (c) => {
    const row = me(c);
    const stepId = c.req.query('stepId');
    if (!stepId) throw new HttpError(400, 'stepId required');
    return c.json(
      fetchSteer(claimDeps(c, row, stepId), row, stepId, {
        batches: c.req.query('batches') === '1',
      }),
    );
  });

  app.post('/api/machine/steer/ack', async (c) => {
    const row = me(c);
    const stepId = c.req.query('stepId');
    if (!stepId) throw new HttpError(400, 'stepId required');
    const body = parseWith(machineSteerAckBodySchema, (await jsonBody(c)) ?? {}, 'body');
    return c.json(ackSteer(claimDeps(c, row, stepId), row, stepId, body));
  });

  app.get('/api/machine/stop', (c) => {
    const row = me(c);
    const stepId = c.req.query('stepId');
    if (!stepId) throw new HttpError(400, 'stepId required');
    return c.json(fetchStop(claimDeps(c, row, stepId), row, stepId));
  });

  app.post('/api/machine/heartbeat/:stepId', async (c) => {
    return executeMachineCommand(
      c,
      () => jsonBody(c),
      async (row, decoded) => {
        const body = parseWith(machineHeartbeatBodySchema, decoded ?? {}, 'body');
        withFencedTransaction(claimDeps(c, row), (settled) => {
          heartbeatStep(settled, row.id, c.req.param('stepId'));
          recordBuildProvenance(settled.db, c.req.param('stepId'), body);
        });
        return c.json({ ok: true as const });
      },
    );
  });

  app.post('/api/machine/tool/:stepId', async (c) => {
    return executeMachineCommand(
      c,
      () => jsonBody(c),
      async (row, raw) => {
        const deps = claimDeps(c, row);
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
        if (isBackgroundTaskBody(raw)) {
          const body = parseWith(machineBackgroundTaskBodySchema, raw, 'body');
          reportBackgroundTask(deps, row.id, c.req.param('stepId'), body.task);
          return c.json({ ok: true as const });
        }
        if (isTranscriptRowBody(raw)) {
          const seg = parseWith(machineTranscriptRowBodySchema, raw, 'body');
          reportTranscriptRow(deps, row.id, c.req.param('stepId'), seg.row);
          return c.json({ ok: true as const });
        }
        if (isComputerRelayBody(raw)) {
          const relay = parseWith(machineComputerRelayBodySchema, raw, 'body');
          return c.json(
            await forwardComputerCall(deps, row.id, c.req.param('stepId'), relay, {
              signal: c.req.raw.signal,
            }),
          );
        }
        if (isRelayBody(raw)) {
          const relay = parseWith(machineToolRelayBodySchema, raw, 'body');
          const text = await executeRelayToolCall(
            deps,
            row.id,
            c.req.param('stepId'),
            relay.name,
            relay.params,
            relay.toolCallId,
            relay.toolCallId === undefined ? undefined : c.req.raw.signal,
            row.tokenHash,
          );
          return c.json({ text });
        }
        const body = parseWith(machineToolBodySchema, raw, 'body');
        reportTool(deps, row.id, c.req.param('stepId'), body as ToolCallRecord);
        return c.json({ ok: true as const });
      },
    );
  });

  app.post('/api/machine/ask/:stepId', async (c) => {
    return executeMachineCommand(
      c,
      () => jsonBody(c),
      async (row, decoded) => {
        const deps = claimDeps(c, row);
        const body = parseWith(machineAskBodySchema, decoded, 'body');
        const rawHold = Number(c.req.query('holdMs'));
        const holdMs =
          Number.isFinite(rawHold) && rawHold >= 0 ? Math.min(rawHold, 70_000) : 70_000;
        return c.json(
          await machineAsk(deps, row.id, c.req.param('stepId'), body, {
            holdMs,
            signal: c.req.raw.signal,
          }),
        );
      },
    );
  });

  app.get('/api/machine/token/:stepId', async (c) => {
    const row = me(c);
    c.header('cache-control', 'no-store');
    const raw = c.req.query('generation');
    const generation = raw !== undefined && /^\d{1,20}$/.test(raw) ? Number(raw) : undefined;
    const refresh = c.req.query('refresh') === '1';
    return c.json(
      await stepToken(deps, row.id, c.req.param('stepId'), generation, 'host', refresh),
    );
  });

  app.get('/api/machine/skills/:stepId', (c) => {
    const row = me(c);
    return c.json(machineSkillsManifest(claimDeps(c, row), row.id, c.req.param('stepId')));
  });
  app.get('/api/machine/skills/:stepId/file', (c) => {
    const row = me(c);
    const bytes = machineSkillFile(
      claimDeps(c, row),
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
        claimDeps(c, row),
        row.id,
        row.teamId,
        c.req.param('stepId'),
        c.req.param('attachmentId'),
        c.req.query('teamId'),
      ),
    );
  });

  app.post('/api/machine/upload-urls/:stepId', async (c) => {
    return executeMachineCommand(
      c,
      () => jsonBody(c),
      async (row, decoded) => {
        const body = parseWith(machineUploadUrlsBodySchema, decoded, 'body');
        const stepId = c.req.param('stepId');
        return c.json(
          createUploadUrls(
            deps,
            row.id,
            stepId,
            body.files,
            originOf(c),
            ctx.uploads,
            generationOf(c),
          ),
        );
      },
    );
  });

  app.put(MACHINE_UPLOAD_PATH, async (c) => {
    const uploadId = c.req.param('uploadId');
    const upload = c.get('machineUpload');
    const completeUpload = () => {
      ctx.uploads.delete(uploadId);
      return c.json({ ok: true as const });
    };
    if (upload.name === PLAN_FILE_NAME) {
      return executeMachineCommand(
        c,
        () => c.req.text(),
        (_row, body) => {
          receivePlanUpload(deps, upload, body);
          return completeUpload();
        },
      );
    }
    if (upload.name === REPO_ARCHIVE_FILE_NAME || upload.name === REPO_ARCHIVE_FAILED_FILE_NAME) {
      return executeMachineCommand(
        c,
        () => c.req.text(),
        (_row, body) => {
          if (upload.name === REPO_ARCHIVE_FILE_NAME) {
            receiveRepoArchive(ctx.machineHub, upload.machineId, upload.stepId, body);
          } else {
            receiveRepoArchiveFailure(ctx.machineHub, upload.machineId, upload.stepId, body);
          }
          return completeUpload();
        },
      );
    }
    if (upload.name === SESSION_FILE_NAME) {
      return executeMachineCommand(
        c,
        () => c.req.text(),
        (_row, body) => {
          receiveSessionUpload(deps, upload, body);
          return completeUpload();
        },
      );
    }
    return executeMachineCommand(
      c,
      () => jsonBody(c),
      (_row, decoded) => {
        const body = parseWith(transcriptUploadSchema, decoded, 'body');
        receiveUpload(deps, upload, body);
        return completeUpload();
      },
    );
  });

  app.get('/api/machine/session/:stepId', (c) => {
    const row = me(c);
    return c.json(getStepSession(claimDeps(c, row), row.id, c.req.param('stepId')));
  });

  app.post('/api/machine/local-merge-recheck/:stepId', async (c) => {
    return executeMachineCommand(
      c,
      () => jsonBody(c),
      async (row, decoded) => {
        const body = parseWith(machineLocalMergeRecheckBodySchema, decoded, 'body');
        return c.json(
          localMergeRecheckAuthorization(claimDeps(c, row), row.id, c.req.param('stepId'), body),
        );
      },
    );
  });

  app.post('/api/machine/done/:stepId', async (c) => {
    return executeMachineCommand(
      c,
      () => jsonBody(c),
      async (row, decoded) => {
        const body = parseWith(machineDoneBodySchema, decoded, 'body');
        await finishStep(deps, row.id, c.req.param('stepId'), body);
        return c.json({ ok: true as const });
      },
    );
  });

  app.post('/api/machine/computer/:callId', async (c) => {
    const callId = parseWith(computerCallIdSchema, c.req.param('callId'), 'callId');
    return executeMachineCommand(
      c,
      () => jsonBody(c),
      async (row, decoded) => {
        const body = parseWith(machineComputerFramesBodySchema, decoded, 'body');
        return c.json(
          receiveComputerFrames(ctx.db, ctx.hub, row.id, callId, body.frames, ctx.secretBox),
        );
      },
    );
  });

  app.post('/api/machine/im/:connId/event', async (c) => {
    const connId = c.req.param('connId');
    return executeMachineCommand(
      c,
      () => jsonBody(c),
      async (row, decoded) => {
        const bridge = ctx.imBridge;
        if (bridge === undefined) throw new HttpError(404, 'im bridge unavailable');
        const bound = bridge.connMachine(connId);
        if (bound === undefined) throw new HttpError(404, 'im connection not attached');
        if (bound !== row.id) throw new HttpError(403, 'im connection bound to another machine');
        const body = parseWith(machineImEventBodySchema, decoded, 'body');
        bridge.handleEvent(connId, body);
        return c.json({ ok: true as const });
      },
    );
  });
}
