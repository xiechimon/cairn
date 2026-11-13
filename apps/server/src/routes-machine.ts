import type { ToolCallRecord } from '@cairn/shared';
import {
  claudeRateLimitReportSchema,
  computerCallIdSchema,
  machineActivityBodySchema,
  machineAgentTodoBodySchema,
  machineAskBodySchema,
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
  machinePresenceBodySchema,
  machineSteerAckBodySchema,
  machineSyncResultBodySchema,
  machineThinkingDeltaBodySchema,
  machineToolBodySchema,
  machineToolRelayBodySchema,
  machineTranscriptDeltaBodySchema,
  machineTranscriptRowBodySchema,
  machineUploadUrlsBodySchema,
  PLAN_FILE_NAME,
  parseSecretSurface,
  SESSION_FILE_NAME,
  transcriptUploadSchema,
} from '@cairn/shared';
import { and, eq, inArray, isNotNull, or } from 'drizzle-orm';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { streamSSE } from 'hono/streaming';
import type { AppContext } from './context.js';
import { build, type machine as machineTable, step, todo } from './db/schema.js';
import { HttpError, parseWith } from './lib/errors.js';
import { forwardedOrigin } from './lib/forwarded-origin.js';
import { newRecordId } from './lib/ids.js';
import { tailnetOriginOf } from './lib/tailnet-listener.js';
import { isLoopbackPeer } from './lib/token-auth.js';
import { githubAppOf } from './routes-helpers.js';
import { transitionBranchSync } from './services/branch-sync.js';
import { recordBuildProvenance } from './services/build-provenance.js';
import { recordClaudeRateLimit } from './services/claude-rate-limit.js';
import { forwardComputerCall, receiveComputerFrames } from './services/machine-computer.js';
import { executeRelayToolCall, machineAsk } from './services/machine-relay.js';
import {
  createUploadUrls,
  getStepSession,
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

function isComputerRelayBody(raw: unknown): boolean {
  return raw !== null && typeof raw === 'object' && 'computer' in raw && raw.computer === true;
}

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

const CLOSED_ORBS_MAX_BODY_BYTES = 64 * 1024;
const COMPUTER_FRAMES_MAX_BODY_BYTES = 24 * 1024 * 1024;

async function jsonBody(c: Context): Promise<unknown> {
  return c.req.json().catch(() => null);
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
    ...(ctx.githubFetch !== undefined ? { githubFetch: ctx.githubFetch } : {}),
    ...(ctx.oauthFetch !== undefined ? { oauthFetch: ctx.oauthFetch } : {}),
  };

  app.use('/api/machine/*', async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (path.startsWith('/api/machine/enroll')) return next();
    const token = bearer(c);
    if (!token) throw unauthorized();
    const row = findMachineByToken(ctx.db, token);
    if (!row) throw unauthorized();
    await next();
    if (findMachineByToken(ctx.db, token)?.id !== row.id) throw unauthorized();
  });

  const me = (c: Context): MachineRow => {
    const token = bearer(c);
    const row = token ? findMachineByToken(ctx.db, token) : undefined;
    if (!row) throw unauthorized();
    return row;
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
      url: `${enrollOrigin(c)}/app/machines/authorize?enroll=${enrollId}`,
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
    if (entry.teamId !== ctx.team.id) {
      throw new HttpError(403, 'enrollment team mismatch');
    }
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

  app.post(
    '/api/machine/orbs/closed',
    bodyLimit({
      maxSize: CLOSED_ORBS_MAX_BODY_BYTES,
      onError: (c) => c.json({ error: 'orb cleanup body too large' }, 413),
    }),
    async (c) => {
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
    },
  );

  app.post('/api/machine/presence', async (c) => {
    return executeMachineCommand(
      c,
      () => jsonBody(c),
      async (row, decoded) => {
        const body = parseWith(machinePresenceBodySchema, decoded ?? {}, 'body');
        markPresence(deps, row.id, body);
        return c.json({ ok: true as const });
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
    return streamSSE(c, async (stream) => {
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
      // undici's default 300s body timeout (measured per received chunk) silently drops an idle SSE stream.
      const pingTimer = setInterval(() => {
        if (findMachineByToken(ctx.db, token)?.id !== row.id) {
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
        markOffline(deps, row.id);
        release();
      });
      await held;
      clearInterval(pingTimer);
      unsubscribe();
    });
  });

  app.get('/api/machine/steer', (c) => {
    const row = me(c);
    const stepId = c.req.query('stepId');
    if (!stepId) throw new HttpError(400, 'stepId required');
    return c.json(fetchSteer({ db: ctx.db }, row, stepId));
  });

  app.post('/api/machine/steer/ack', async (c) => {
    const row = me(c);
    const stepId = c.req.query('stepId');
    if (!stepId) throw new HttpError(400, 'stepId required');
    const body = parseWith(machineSteerAckBodySchema, (await jsonBody(c)) ?? {}, 'body');
    return c.json(
      ackSteer({ db: ctx.db, convHub: ctx.convHub, machineHub: ctx.machineHub }, row, stepId, body),
    );
  });

  app.get('/api/machine/stop', (c) => {
    const row = me(c);
    const stepId = c.req.query('stepId');
    if (!stepId) throw new HttpError(400, 'stepId required');
    return c.json(fetchStop({ db: ctx.db }, row, stepId));
  });

  app.post('/api/machine/heartbeat/:stepId', async (c) => {
    return executeMachineCommand(
      c,
      () => jsonBody(c),
      async (row, decoded) => {
        const body = parseWith(machineHeartbeatBodySchema, decoded ?? {}, 'body');
        heartbeatStep(deps, row.id, c.req.param('stepId'));
        recordBuildProvenance(ctx.db, c.req.param('stepId'), body);
        return c.json({ ok: true as const });
      },
    );
  });

  app.post('/api/machine/tool/:stepId', async (c) => {
    return executeMachineCommand(
      c,
      () => jsonBody(c),
      async (row, raw) => {
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
    return c.json(
      await stepToken(
        deps,
        row.id,
        c.req.param('stepId'),
        parseSecretSurface(c.req.query('surface')),
      ),
    );
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
    return executeMachineCommand(
      c,
      () => jsonBody(c),
      async (row, decoded) => {
        const body = parseWith(machineUploadUrlsBodySchema, decoded, 'body');
        return c.json(
          createUploadUrls(
            deps,
            row.id,
            c.req.param('stepId'),
            body.files,
            originOf(c),
            ctx.uploads,
          ),
        );
      },
    );
  });

  app.put('/api/machine/upload/:uploadId', async (c) => {
    const row = me(c);
    const uploadId = c.req.param('uploadId');
    const upload = ctx.uploads.get(uploadId);
    if (!upload || upload.machineId !== row.id) throw new HttpError(404, 'upload not found');
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
    return c.json(getStepSession(deps, row.id, c.req.param('stepId')));
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

  app.post('/api/machine/sync-result/:syncId', async (c) => {
    return executeMachineCommand(
      c,
      () => jsonBody(c),
      async (row, decoded) => {
        const body = parseWith(machineSyncResultBodySchema, decoded, 'body');
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
      },
    );
  });

  app.post(
    '/api/machine/computer/:callId',
    bodyLimit({
      maxSize: COMPUTER_FRAMES_MAX_BODY_BYTES,
      onError: (c) => c.json({ error: 'computer frames body too large' }, 413),
    }),
    async (c) => {
      const callId = parseWith(computerCallIdSchema, c.req.param('callId'), 'callId');
      return executeMachineCommand(
        c,
        () => jsonBody(c),
        async (row, decoded) => {
          const body = parseWith(machineComputerFramesBodySchema, decoded, 'body');
          return c.json(receiveComputerFrames(ctx.db, ctx.hub, row.id, callId, body.frames));
        },
      );
    },
  );
}
