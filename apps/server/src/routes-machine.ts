import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { ToolCallRecord } from '@cairn/shared';
import {
  claudeRateLimitReportSchema,
  computerCallIdSchema,
  enrollDisplayName,
  isServerVersionNewer,
  MACHINE_ENROLL_TTL_MS,
  MIN_SUPPORTED_RUNNER_PROTOCOL,
  machineActivityBodySchema,
  machineAgentTodoBodySchema,
  machineAntigravityModelProbeBodySchema,
  machineAntigravityUsageProbeClaimBodySchema,
  machineAntigravityUsageProbeResultBodySchema,
  machineAntigravityVerifyBodySchema,
  machineAskBodySchema,
  machineBackgroundTaskBodySchema,
  machineClaimBodySchema,
  machineComputerFramesBodySchema,
  machineComputerRelayBodySchema,
  machineDoneBodySchema,
  machineDoubaoLoginEventBodySchema,
  machineDoubaoVerifyBodySchema,
  machineEnrollBodySchema,
  machineEnrollConfirmBodySchema,
  machineEnrollPollBodySchema,
  machineEnrollStartBodySchema,
  machineHeartbeatBodySchema,
  machineImEventBodySchema,
  machineLocalMergeRecheckBodySchema,
  machineOfflineBodySchema,
  machinePhoneConsentBodySchema,
  machinePresenceBodySchema,
  machineSteerAckBodySchema,
  machineThinkingDeltaBodySchema,
  machineTokenRotateAckBodySchema,
  machineTokenRotateClaimBodySchema,
  machineToolBodySchema,
  machineToolRelayBodySchema,
  machineTranscriptDeltaBodySchema,
  machineTranscriptRowBodySchema,
  machineUploadUrlsBodySchema,
  machineWorkspaceFileReplySchema,
  normalizeEnrollCode,
  PLAN_FILE_NAME,
  parseReportedCapabilities,
  parseStoredCapabilities,
  runnerNeedsVersionUpdate,
  runnerOutOfWindow,
  SESSION_FILE_NAME,
  transcriptUploadSchema,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Context, Hono } from 'hono';
import type { AppContext } from './context.js';
import { type machine as machineTable, step } from './db/schema.js';
import { sha256Hex } from './lib/crypto.js';
import { HttpError, parseWith } from './lib/errors.js';
import { forwardedOrigin } from './lib/forwarded-origin.js';
import { newRecordId } from './lib/ids.js';
import {
  forwardedHostFor,
  isDirectLoopbackPeer,
  isTrustedProxyPeer,
  pairRequestPeerOf,
} from './lib/request-origin.js';
import { openSseStream } from './lib/sse-headers.js';
import { tailnetOriginOf } from './lib/tailnet-listener.js';
import { githubAppOf, jsonBody } from './routes-helpers.js';
import {
  claimAntigravityModelProbe,
  finishAntigravityModelProbe,
} from './services/antigravity-model-probes.js';
import {
  claimAntigravityUsageProbe,
  finishAntigravityUsageProbe,
} from './services/antigravity-usage-probes.js';
import { recordBuildProvenance } from './services/build-provenance.js';
import { recordClaudeRateLimit } from './services/claude-rate-limit.js';
import { hasActiveDevinSubscription } from './services/devin-subscriptions.js';
import { activeTeamGithubRepos } from './services/git.js';
import { localMergeRecheckAuthorization } from './services/local-merge.js';
import { receiveAntigravityVerify } from './services/machine-antigravity-verify.js';
import { scopeMachineClaim } from './services/machine-claim-scope.js';
import {
  computerCallDownloadAttachment,
  computerCallUploadAttachment,
  forwardComputerCall,
  machinePhoneConsented,
  receiveComputerFrames,
} from './services/machine-computer.js';
import { withFencedTransaction } from './services/machine-deps.js';
import { applyDoubaoLoginEvent } from './services/machine-doubao-login.js';
import { receiveDoubaoVerify } from './services/machine-doubao-verify.js';
import { executeRelayToolCall, machineAsk } from './services/machine-relay.js';
import {
  ackMachineTokenRotation,
  armOverdueTokenRotationOnConnect,
  claimMachineTokenRotation,
} from './services/machine-rotate-token.js';
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
import { readServerVersionInfo } from './services/server-version.js';
import { acceptWorkspaceFile } from './services/workspace-file-read.js';

function resolvePresenceTargetVersion(
  latestRelease: string | null,
  serverVersion: string | null,
): string | null {
  if (latestRelease !== null && serverVersion !== null) {
    return isServerVersionNewer(latestRelease, serverVersion) ? latestRelease : serverVersion;
  }
  return latestRelease ?? serverVersion;
}

function presenceUpdateFor(
  ctx: AppContext,
  row: typeof machineTable.$inferSelect,
  reportedCapabilities: unknown,
): { targetVersion: string } | undefined {
  const effectiveCaps =
    (reportedCapabilities !== undefined
      ? parseReportedCapabilities(reportedCapabilities)
      : undefined) ?? parseStoredCapabilities(row.capabilities);
  if (effectiveCaps == null) return undefined;
  const autoUpdate = effectiveCaps.runnerAutoUpdate;
  if (autoUpdate?.supported !== true || autoUpdate.state === 'unsupported') return undefined;
  const serverVersion = readServerVersionInfo({ deployRecordPath: ctx.deployRecordPath }).version;
  const targetVersion = resolvePresenceTargetVersion(
    ctx.releaseWatcher?.latestRelease() ?? null,
    serverVersion,
  );
  if (targetVersion === null) return undefined;
  if (autoUpdate.state === 'rolled-back' && autoUpdate.failedVersion === targetVersion) {
    return undefined;
  }
  if (effectiveCaps.runnerReleaseVersion === targetVersion) return undefined;
  if (!runnerNeedsVersionUpdate(effectiveCaps, targetVersion)) return undefined;
  return { targetVersion };
}

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

function enrollOrigin(c: Context, trustedProxies?: ReadonlySet<string>): string {
  const configured = process.env.CAIRN_WEB_ORIGIN?.trim();
  if (configured !== undefined && configured !== '') {
    try {
      return new URL(configured).origin;
    } catch {}
  }
  return originOf(c, trustedProxies);
}

function originOf(c: Context, trustedProxies?: ReadonlySet<string>): string {
  return (
    tailnetOriginOf(c) ??
    forwardedOrigin({
      url: c.req.url,
      trustedProxy: isTrustedProxyPeer(c, trustedProxies),
      proto: c.req.header('x-forwarded-proto'),
      host: forwardedHostFor(c.req.header('host'), c.req.header('x-forwarded-host')),
    })
  );
}

export function registerMachineAuth(app: Hono, ctx: Pick<AppContext, 'db' | 'uploads'>): void {
  app.use('/api/machine/*', async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (path.startsWith('/api/machine/enroll') || path === '/api/machine/token-rotate/ack') {
      return next();
    }
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
    if (raw === undefined) return undefined;
    const generation = /^\d{1,20}$/.test(raw) ? Number(raw) : Number.NaN;
    return Number.isSafeInteger(generation) ? generation : -1;
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
      serverUrl: originOf(c, ctx.trustedProxies),
    });
    if (body.claudeCode !== undefined) await resumeRuntimeHeldBuilds(deps, body.teamId);
    return c.json(result);
  });

  const ENROLL_CAP = 100;
  const ENROLL_START_RATE_CAP = 20;
  const ENROLL_START_RATE_WINDOW_MS = 600_000;
  const ENROLL_START_PEER_CAP = 1_000;
  const enrollStartRates = new Map<string, number[]>();

  const matchesPollSecret = (expectedHash: string, provided: string): boolean => {
    const left = Buffer.from(expectedHash, 'hex');
    const right = Buffer.from(sha256Hex(provided), 'hex');
    return left.byteLength === right.byteLength && timingSafeEqual(left, right);
  };

  app.post('/api/machine/enroll/start', async (c) => {
    const now = Date.now();
    const { peer } = pairRequestPeerOf(c, ctx.trustedProxies);
    const cutoff = now - ENROLL_START_RATE_WINDOW_MS;
    if (enrollStartRates.size >= ENROLL_START_PEER_CAP && !enrollStartRates.has(peer)) {
      for (const [trackedPeer, timestamps] of enrollStartRates) {
        const fresh = timestamps.filter((t) => t > cutoff);
        if (fresh.length === 0) enrollStartRates.delete(trackedPeer);
        else enrollStartRates.set(trackedPeer, fresh);
      }
      if (enrollStartRates.size >= ENROLL_START_PEER_CAP) {
        throw new HttpError(429, 'too many enrollment requests; wait and retry');
      }
    }
    const recent = (enrollStartRates.get(peer) ?? []).filter((t) => t > cutoff);
    if (recent.length >= ENROLL_START_RATE_CAP) {
      throw new HttpError(429, 'too many enrollment requests; wait and retry');
    }
    recent.push(now);
    enrollStartRates.delete(peer);
    enrollStartRates.set(peer, recent);

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
    for (const [id, e] of ctx.enrollments) {
      if (now - e.createdAt > MACHINE_ENROLL_TTL_MS) ctx.enrollments.delete(id);
    }
    if (ctx.enrollments.size >= ENROLL_CAP) {
      throw new HttpError(429, 'too many pending enrollments; wait and retry');
    }
    const enrollId = newRecordId();
    const code = newEnrollCode(new Set([...ctx.enrollments.values()].map((e) => e.code)));
    const pollSecret = randomBytes(32).toString('base64url');
    ctx.enrollments.set(enrollId, {
      teamId: body.teamId ?? ctx.team.id,
      name: body.name,
      code,
      pollSecretHash: sha256Hex(pollSecret),
      createdAt: now,
      fromLocalHost,
      ...(body.hostKey !== undefined ? { hostKey: body.hostKey } : {}),
      ...(body.legacyHostKeys !== undefined ? { legacyHostKeys: body.legacyHostKeys } : {}),
    });
    c.header('cache-control', 'no-store');
    return c.json({
      enrollId,
      url: `${enrollOrigin(c, ctx.trustedProxies)}/app/machines/authorize?enroll=${enrollId}`,
      code: `${code.slice(0, 4)}-${code.slice(4)}`,
      pollSecret,
    });
  });

  app.post('/api/machine/enroll/poll', async (c) => {
    c.header('cache-control', 'no-store');
    const body = parseWith(machineEnrollPollBodySchema, await jsonBody(c), 'body');
    const pending = ctx.enrollments.get(body.enrollId);
    if (!pending || Date.now() - pending.createdAt > MACHINE_ENROLL_TTL_MS) {
      if (pending) ctx.enrollments.delete(body.enrollId);
      return c.json({ status: 'expired' });
    }
    if (
      body.pollSecret !== undefined &&
      !matchesPollSecret(pending.pollSecretHash, body.pollSecret)
    ) {
      throw new HttpError(403, 'invalid poll secret');
    }
    const name = enrollDisplayName(pending.name);
    if (pending.authorized === true) {
      if (body.pollSecret !== undefined && pending.machine !== undefined) {
        const machine = pending.machine;
        delete pending.machine;
        return c.json({ status: 'authorized', machine });
      }
      return c.json({ status: 'authorized', ...(name !== undefined ? { name } : {}) });
    }
    return c.json({
      status: 'pending',
      ...(name !== undefined ? { name } : {}),
      code: `${pending.code.slice(0, 4)}-${pending.code.slice(4)}`,
    });
  });

  app.post('/api/machine/enroll/confirm', async (c) => {
    c.header('cache-control', 'no-store');
    const body = parseWith(machineEnrollConfirmBodySchema, await jsonBody(c), 'body');
    const entry =
      'enrollId' in body
        ? ctx.enrollments.get(body.enrollId)
        : [...ctx.enrollments.values()].find((e) => e.code === normalizeEnrollCode(body.code));
    if (!entry || Date.now() - entry.createdAt > MACHINE_ENROLL_TTL_MS) {
      throw new HttpError(404, 'enrollment unknown or expired');
    }
    if (entry.authorized === true || entry.machine !== undefined) {
      throw new HttpError(409, 'enrollment already authorized');
    }
    if (entry.teamId !== ctx.team.id) {
      throw new HttpError(403, 'enrollment team mismatch');
    }
    const machineJson = authorizeEnrollmentMachine(deps, {
      teamId: entry.teamId,
      name: entry.name ?? 'machine',
      serverUrl: originOf(c, ctx.trustedProxies),
      ownerApproved: ctx.authToken === null || c.get('ownerIdentity') !== undefined,
      fromLocalHost: entry.fromLocalHost === true,
      ...(entry.hostKey !== undefined ? { hostKey: entry.hostKey } : {}),
      ...(entry.legacyHostKeys !== undefined ? { legacyHostKeys: entry.legacyHostKeys } : {}),
      ...(body.retireToken !== undefined ? { retireToken: body.retireToken } : {}),
    });
    entry.authorized = true;
    entry.machine = machineJson;
    return c.json({ machine: machineJson });
  });

  app.get('/api/machine/me', (c) => {
    const row = me(c);
    return c.json(toMachineRecord(row, machineRunningCount(deps.db, row.id)));
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
        const githubRepos = activeTeamGithubRepos(ctx.db, row.teamId);
        const update = presenceUpdateFor(ctx, row, body.capabilities);
        return c.json({
          ok: true as const,
          ...(hasActiveDevinSubscription(deps, row.teamId) ? { installDevin: true } : {}),
          ...(phones.length > 0 ? { phones } : {}),
          ...(githubRepos.length > 0 ? { githubRepos } : {}),
          ...(update !== undefined ? { update } : {}),
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
        if (runnerOutOfWindow(row.capabilities, MIN_SUPPORTED_RUNNER_PROTOCOL)) {
          throw new HttpError(
            426,
            'Cairn on this Runner is too old for this server; update Cairn on that computer',
            undefined,
            { code: 'runner-out-of-window' },
          );
        }
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
      armOverdueTokenRotationOnConnect(ctx.db, row.id);
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

  app.post('/api/machine/antigravity/usage/:requestId/claim', async (c) => {
    const requestId = c.req.param('requestId');
    return executeMachineCommand(
      c,
      () => jsonBody(c),
      (row, decoded) => {
        const body = parseWith(machineAntigravityUsageProbeClaimBodySchema, decoded, 'body');
        const claim = claimAntigravityUsageProbe(
          ctx.machineHub,
          requestId,
          row.id,
          body.connectionId,
        );
        if (claim === undefined) throw new HttpError(404, 'Usage probe not found');
        return c.json(claim, 200, { 'Cache-Control': 'no-store' });
      },
    );
  });

  app.post('/api/machine/antigravity/usage/:requestId/result', async (c) => {
    const requestId = c.req.param('requestId');
    return executeMachineCommand(
      c,
      () => jsonBody(c),
      (row, decoded) => {
        const body = parseWith(machineAntigravityUsageProbeResultBodySchema, decoded, 'body');
        const accepted = finishAntigravityUsageProbe(
          ctx.machineHub,
          requestId,
          row.id,
          body.connectionId,
          body.result,
        );
        if (accepted === 'not-found') throw new HttpError(404, 'Usage probe not found');
        if (accepted === 'revoked') {
          throw new HttpError(409, 'Usage probe authorization changed after claim', undefined, {
            code: 'probe-authorization-changed',
          });
        }
        return c.json({ ok: true as const });
      },
    );
  });

  app.post('/api/machine/workspace-file/:requestId', async (c) => {
    const requestId = c.req.param('requestId');
    return executeMachineCommand(
      c,
      () => jsonBody(c),
      (row, decoded) => {
        const body = parseWith(machineWorkspaceFileReplySchema, decoded, 'body');
        if (!acceptWorkspaceFile(ctx.machineHub, row.id, requestId, body)) {
          throw new HttpError(404, 'Workspace file request not found');
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

  app.post('/api/machine/doubao/verify', async (c) => {
    return executeMachineCommand(
      c,
      () => jsonBody(c),
      async (row, decoded) => {
        const body = parseWith(machineDoubaoVerifyBodySchema, decoded ?? {}, 'body');
        receiveDoubaoVerify(deps, row.id, body);
        return c.json({ ok: true as const });
      },
    );
  });

  app.post('/api/machine/doubao-login-event', async (c) => {
    return executeMachineCommand(
      c,
      () => jsonBody(c),
      async (row, decoded) => {
        const body = parseWith(machineDoubaoLoginEventBodySchema, decoded ?? {}, 'body');
        applyDoubaoLoginEvent(deps, row.id, body);
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
        const stepId = c.req.param('stepId');
        const body = parseWith(machineHeartbeatBodySchema, decoded ?? {}, 'body');
        withFencedTransaction(claimDeps(c, row, stepId), (settled) => {
          heartbeatStep(settled, row.id, stepId);
          recordBuildProvenance(settled.db, stepId, body);
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
        const stepId = c.req.param('stepId');
        const deps = claimDeps(c, row, stepId);
        if (isDeltaBody(raw)) {
          const delta = parseWith(machineTranscriptDeltaBodySchema, raw, 'body');
          reportTranscriptDelta(deps, row.id, stepId, delta.text);
          return c.json({ ok: true as const });
        }
        if (isThinkingDeltaBody(raw)) {
          const delta = parseWith(machineThinkingDeltaBodySchema, raw, 'body');
          reportThinkingDelta(deps, row.id, stepId, delta.text);
          return c.json({ ok: true as const });
        }
        if (isActivityBody(raw)) {
          const act = parseWith(machineActivityBodySchema, raw, 'body');
          reportActivity(deps, row.id, stepId, act.activity);
          return c.json({ ok: true as const });
        }
        if (isAgentTodoBody(raw)) {
          const body = parseWith(machineAgentTodoBodySchema, raw, 'body');
          reportAgentTodo(deps, row.id, stepId, body.todo);
          return c.json({ ok: true as const });
        }
        if (isBackgroundTaskBody(raw)) {
          const body = parseWith(machineBackgroundTaskBodySchema, raw, 'body');
          reportBackgroundTask(deps, row.id, stepId, body.task);
          return c.json({ ok: true as const });
        }
        if (isTranscriptRowBody(raw)) {
          const seg = parseWith(machineTranscriptRowBodySchema, raw, 'body');
          reportTranscriptRow(deps, row.id, stepId, seg.row, {
            workspace: seg.workspace,
            generation: generationOf(c),
          });
          return c.json({ ok: true as const });
        }
        if (isComputerRelayBody(raw)) {
          const relay = parseWith(machineComputerRelayBodySchema, raw, 'body');
          return c.json(
            await forwardComputerCall(deps, row.id, stepId, relay, {
              signal: c.req.raw.signal,
            }),
          );
        }
        if (isRelayBody(raw)) {
          const relay = parseWith(machineToolRelayBodySchema, raw, 'body');
          const text = await executeRelayToolCall(
            deps,
            row.id,
            stepId,
            relay.name,
            relay.params,
            relay.toolCallId,
            relay.toolCallId === undefined ? undefined : c.req.raw.signal,
            row.tokenHash,
          );
          return c.json({ text });
        }
        const body = parseWith(machineToolBodySchema, raw, 'body');
        reportTool(deps, row.id, stepId, body as ToolCallRecord);
        return c.json({ ok: true as const });
      },
    );
  });

  app.post('/api/machine/ask/:stepId', async (c) => {
    return executeMachineCommand(
      c,
      () => jsonBody(c),
      async (row, decoded) => {
        const stepId = c.req.param('stepId');
        const deps = claimDeps(c, row, stepId);
        const body = parseWith(machineAskBodySchema, decoded, 'body');
        const rawHold = Number(c.req.query('holdMs'));
        const holdMs =
          Number.isFinite(rawHold) && rawHold >= 0 ? Math.min(rawHold, 70_000) : 70_000;
        return c.json(
          await machineAsk(deps, row.id, stepId, body, {
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
    const generation = generationOf(c);
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
    const stepId = c.req.param('stepId');
    return c.json(getStepSession(claimDeps(c, row, stepId), row.id, stepId));
  });

  app.post('/api/machine/local-merge-recheck/:stepId', async (c) => {
    return executeMachineCommand(
      c,
      () => jsonBody(c),
      async (row, decoded) => {
        const stepId = c.req.param('stepId');
        const body = parseWith(machineLocalMergeRecheckBodySchema, decoded, 'body');
        return c.json(
          localMergeRecheckAuthorization(claimDeps(c, row, stepId), row.id, stepId, body),
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

  app.post('/api/machine/phone-consent', async (c) => {
    return executeMachineCommand(
      c,
      () => jsonBody(c),
      async (row, decoded) => {
        const body = parseWith(machinePhoneConsentBodySchema, decoded, 'body');
        return c.json({
          ok: true as const,
          consented: machinePhoneConsented(
            ctx.db,
            row.teamId,
            row.id,
            body.phoneId,
            body.deviceId,
            body.callId,
          ),
        });
      },
    );
  });

  app.get('/api/machine/computer/:callId/attachment', (c) => {
    const callId = parseWith(computerCallIdSchema, c.req.param('callId'), 'callId');
    const row = me(c);
    const file = computerCallDownloadAttachment(deps, row.id, callId);
    return new Response(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(file.bytes.length),
        'cache-control': 'no-store',
        'x-cairn-filename': encodeURIComponent(file.fileName),
      },
    });
  });

  app.post('/api/machine/computer/:callId/attachment', async (c) => {
    const callId = parseWith(computerCallIdSchema, c.req.param('callId'), 'callId');
    const rawFileName = c.req.header('x-cairn-filename');
    if (rawFileName === undefined || rawFileName === '') {
      throw new HttpError(400, 'missing x-cairn-filename header');
    }
    let fileName: string;
    let caption: string | undefined;
    try {
      fileName = decodeURIComponent(rawFileName);
      const rawCaption = c.req.header('x-cairn-caption');
      if (rawCaption !== undefined) caption = decodeURIComponent(rawCaption);
    } catch {
      throw new HttpError(400, 'invalid attachment header encoding');
    }
    return executeMachineCommand(
      c,
      async () => Buffer.from(await c.req.arrayBuffer()),
      (row, bytes) =>
        c.json(
          computerCallUploadAttachment(deps, row.id, callId, { fileName, caption, bytes }),
          201,
        ),
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

  app.post('/api/machine/token-rotate/claim', async (c) => {
    return executeMachineCommand(
      c,
      () => jsonBody(c),
      async (row, decoded) => {
        const body = parseWith(machineTokenRotateClaimBodySchema, decoded, 'body');
        const token = claimMachineTokenRotation(
          deps,
          row.id,
          body.rotationId,
          body.connectionId,
          body.hostKey,
          body.legacyHostKeys,
        );
        if (token === null) {
          throw new HttpError(404, 'rotation not found');
        }
        c.header('cache-control', 'no-store');
        return c.json({ token });
      },
    );
  });

  app.post('/api/machine/token-rotate/ack', async (c) => {
    const token = bearer(c);
    if (!token) throw unauthorized();
    const body = parseWith(machineTokenRotateAckBodySchema, await jsonBody(c), 'body');
    return c.json(ackMachineTokenRotation(deps, body.rotationId, token));
  });
}
