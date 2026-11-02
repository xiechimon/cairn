import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentSessionHandle, ClaimedStep, MachineDoneBody } from '@cairn/shared';
import { TranscriptBuffer } from '../journal.js';
import { MachineApiError } from '../machine-client.js';
import { writePrivateFile } from '../private-fs.js';
import { type RunStepDeps, type RunStepOptions, resumePendingUpload, runStep } from '../runner.js';
import { StepStops } from '../step-stops.js';
import type { OrbLifecycle } from './lifecycle.js';
import {
  isOrbPathId,
  ORB_STEP_METHODS,
  type OrbFrame,
  type OrbStepInput,
  orbCheckpointSchema,
  orbReleaseKeySchema,
} from './protocol.js';
import { type OrbHandle, orbNote } from './provider.js';
import { RelayMachineServer, RelayPathError } from './relay.js';
import { cleanOrbOutbox } from './runtime-fs.js';

export const ORB_HEARTBEAT_TIMEOUT_MS = 120_000;

export async function runOrbStep(
  lifecycle: OrbLifecycle,
  deps: RunStepDeps & { orbProxyUrl?: string; orbHeartbeatTimeoutMs?: number },
  claimed: ClaimedStep,
  options: RunStepOptions = {},
): Promise<void> {
  if (lifecycle.provider.kind === 'host' || claimed.step.kind === 'chief') {
    const env = { ...options.env };
    delete env.CAIRN_ORB;
    await runStep(deps, claimed, { ...options, env });
    return;
  }
  const stepId = claimed.step.id;
  if (!isOrbPathId(stepId)) throw new Error('Invalid orb step id');
  deps.journal.claim({
    stepId,
    buildId: claimed.step.buildId,
    kind: claimed.step.kind,
    conversationId: claimed.conversationId,
    sessionAction: claimed.session.action,
    sessionId: options.resume?.sessionId ?? claimed.session.sessionId,
    prompt: options.resume?.prompt ?? claimed.instruction ?? null,
    claimed,
  });
  const stop = (deps.stops ?? new StepStops()).enter(stepId, (stopRequest) => {
    deps.journal.update(stepId, { stopRequest });
  });
  if (options.stopRequest) stop.accept(options.stopRequest);
  const heartbeat = setInterval(() => {
    void deps.client.heartbeat(stepId).catch((error: unknown) => {
      if (error instanceof MachineApiError && error.status === 410)
        void stop.deliver({ discard: false });
    });
  }, deps.heartbeatIntervalMs ?? 30_000);
  heartbeat.unref?.();
  const orbStartedAt = Date.now();
  let relay: RelayMachineServer | undefined;
  let workerReported = false;
  let exitError = 'Orb worker disconnected without done';
  let finishTransport: () => void = () => {};
  const transportEnded = new Promise<void>((resolve) => {
    finishTransport = resolve;
  });
  const execController = new AbortController();
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let providerStop: Promise<void> | undefined;
  let activeHandle: OrbHandle | undefined;
  let timedOut = false;
  let outboxDirectory: string | undefined;
  let ownsOutbox = false;
  let ready = false;
  let ended = false;
  let nextSteer = 0;
  const waiting = new Set<{ resolve: () => void; reject: (error: Error) => void }>();
  const steering = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();
  const send = (frame: OrbFrame) => relay?.send(frame);
  const session: AgentSessionHandle = {
    sessionId: claimed.session.sessionId ?? stepId,
    events: (async function* () {})(),
    async steer(text, images) {
      if (ended) throw new Error('Orb worker ended');
      if (!ready) await new Promise<void>((resolve, reject) => waiting.add({ resolve, reject }));
      const id = nextSteer++;
      await new Promise<void>((resolve, reject) => {
        steering.set(id, { resolve, reject });
        send({ type: 'steer', id, text, images });
      });
    },
    async stop() {
      send({ type: 'stop', discard: stop.request?.discard ?? false });
      stopTimer ??= setTimeout(() => {
        exitError = 'Orb worker did not finish after stop';
        void relay?.close();
        execController.abort();
        finishTransport();
        if (activeHandle)
          providerStop ??= lifecycle.provider.stop(activeHandle).catch((error: unknown) => {
            deps.logger.step(`Orb stop failed: ${String(error)}`);
          });
      }, 5_000);
      stopTimer.unref?.();
    },
    usage: () => [],
  };
  deps.sessionHandles?.set(stepId, session);
  try {
    await lifecycle.run(
      {
        conversationId: claimed.conversationId,
        projectId: claimed.project?.id ?? claimed.conversationId,
      },
      async (handle) => {
        activeHandle = handle;
        handle.lastStepId = stepId;
        lifecycle.provider.touch(handle, Date.now());
        const methods: OrbStepInput['methods'] = ORB_STEP_METHODS.filter(
          (method) => deps.client[method] !== undefined,
        );
        if (claimed.project?.repo?.kind === 'local') methods.push('deliverBundle');
        const input: OrbStepInput = {
          claimed,
          options: { ...options, hookNotes: handle.notes.splice(0), orbStartedAt },
          machineName: deps.machineName,
          methods,
        };
        const projectId = claimed.project?.id;
        if (projectId && !isOrbPathId(projectId)) throw new Error('Invalid orb project id');
        const seed =
          claimed.project?.repo?.kind === 'local'
            ? claimed.project.repo.cloneUrl
            : projectId
              ? join(deps.workspacesDir, projectId, 'repo')
              : null;
        const directory = await lifecycle.provider.prepare(
          handle,
          seed && existsSync(seed) ? seed : undefined,
        );
        const release = orbReleaseKeySchema.parse(handle.expectedReleaseKey);
        let staleRelease: string | undefined;
        void stop.attach(session).catch((error: unknown) => deps.logger.step(String(error)));
        watchdog = setTimeout(() => {
          timedOut = true;
          exitError = staleRelease
            ? `Orb worker release mismatch: expected ${release}, received ${staleRelease}; startup timed out`
            : 'orb heartbeat timeout';
          void relay?.close();
          execController.abort();
          finishTransport();
          providerStop ??= lifecycle.provider.stop(handle).catch((error: unknown) => {
            deps.logger.step(`Orb stop failed: ${String(error)}`);
          });
        }, deps.orbHeartbeatTimeoutMs ?? ORB_HEARTBEAT_TIMEOUT_MS);
        watchdog.unref?.();
        try {
          await lifecycle.provider.start(handle, { signal: execController.signal });
          const socketPath = join(directory, 'relay.sock');
          if (claimed.project?.repo?.kind === 'local') {
            outboxDirectory = join(directory, 'outbox');
          }
          let failure: string | null = null;
          const receive = (frame: OrbFrame): void => {
            if (frame.type === 'checkpoint') {
              const parsed = orbCheckpointSchema.safeParse(frame.checkpoint);
              if (parsed.success) {
                const { transcript, sessionContent, ...checkpoint } = parsed.data;
                if (transcript) {
                  writePrivateFile(
                    join(deps.paths.outboxDir, `step-${stepId}.transcript.json`),
                    JSON.stringify(transcript),
                  );
                }
                const sessionFile = join(deps.paths.outboxDir, `step-${stepId}.session.jsonl`);
                if (sessionContent != null) writePrivateFile(sessionFile, sessionContent);
                deps.journal.update(stepId, {
                  ...checkpoint,
                  ...(sessionContent !== undefined
                    ? { sessionFile: sessionContent === null ? null : sessionFile }
                    : {}),
                });
              }
              return;
            }
            if (frame.type === 'session') {
              if (stop.request) send({ type: 'stop', discard: stop.request.discard });
              clearInterval(heartbeat);
              ready = frame.live;
              if (ready) {
                for (const waiter of waiting) waiter.resolve();
                waiting.clear();
              }
              return;
            }
            if (frame.type === 'steered') {
              const pending = steering.get(frame.id);
              steering.delete(frame.id);
              if (frame.error) pending?.reject(new Error(frame.error));
              else pending?.resolve();
              return;
            }
            if (frame.type === 'failed') {
              failure = frame.error;
              return;
            }
            if (frame.type === 'finished') {
              finishTransport();
              return;
            }
            if (frame.type === 'log') {
              deps.logger.step(frame.message);
              return;
            }
          };
          relay = new RelayMachineServer({
            socketPath,
            stepId,
            release,
            onStaleRelease: (loaded) => {
              staleRelease = loaded;
            },
            onAuthenticated: (loaded) => {
              lifecycle.provider.authenticateRelease(handle, loaded);
              staleRelease = undefined;
            },
            machineId: claimed.step.machineId ?? undefined,
            upstream: deps.client,
            ...(outboxDirectory && claimed.project?.repo?.kind === 'local'
              ? {
                  localDelivery: {
                    outboxDir: outboxDirectory,
                    repoPath: claimed.project.repo.cloneUrl,
                    conversationId: claimed.conversationId,
                  },
                }
              : {}),
            input: () => ({
              ...input,
              options: {
                ...input.options,
                hookNotes: [
                  ...(input.options.hookNotes ?? []),
                  ...handle.notes.splice(0),
                  orbNote(
                    `orb: started in ${Date.now() - orbStartedAt}ms`,
                    Date.now() - orbStartedAt,
                  ),
                ],
                stopRequest: stop.request ?? undefined,
                env: {
                  ...input.options.env,
                  ...(deps.orbProxyUrl
                    ? { HTTP_PROXY: deps.orbProxyUrl, HTTPS_PROXY: deps.orbProxyUrl }
                    : {}),
                },
              },
            }),
            onFrame: receive,
            onDisconnect: finishTransport,
            onActivity: () => watchdog?.refresh(),
            onReporting: (body) => {
              workerReported = true;
              deps.journal.update(stepId, {
                state: 'awaiting-upload',
                doneBody: body,
              });
            },
            onDone: () => {
              finishTransport();
              clearTimeout(watchdog);
              deps.journal.remove(stepId);
              rmSync(join(deps.paths.outboxDir, `step-${stepId}.session.jsonl`), { force: true });
            },
          });
          for (let attempt = 0; ; attempt++) {
            try {
              if (outboxDirectory) {
                try {
                  mkdirSync(outboxDirectory, { mode: 0o700 });
                  ownsOutbox = true;
                } catch (error) {
                  throw new RelayPathError(
                    `Orb outbox must be recreated by root: ${String(error)}`,
                  );
                }
              }
              await relay.listen();
              break;
            } catch (error) {
              if (handle.running) await lifecycle.provider.stop(handle);
              ownsOutbox = false;
              if (!(error instanceof RelayPathError) || attempt > 0) throw error;
              await lifecycle.provider.start(handle, { signal: execController.signal });
            }
          }
          input.options.stopRequest = stop.request ?? undefined;
          await transportEnded;
          if (stop.request)
            providerStop ??= lifecycle.provider.stop(handle).catch((error: unknown) => {
              deps.logger.step(`Orb stop failed: ${String(error)}`);
            });
          if (failure) deps.logger.step(`Orb worker failed: ${failure}`);
        } finally {
          clearTimeout(watchdog);
          await providerStop;
        }
      },
    );
  } catch (error) {
    if (!timedOut) exitError = error instanceof Error ? error.message : String(error);
    deps.logger.step(`Orb step exited: ${exitError}`);
  } finally {
    ended = true;
    const error = new Error('Orb worker ended before steer delivery');
    for (const pending of [...waiting, ...steering.values()]) pending.reject(error);
    deps.sessionHandles?.delete(stepId);
    clearInterval(heartbeat);
    clearTimeout(stopTimer);
    clearTimeout(watchdog);
    stop.detach();
    try {
      await relay?.close();
    } catch (error) {
      deps.logger.step(`Orb relay close failed: ${String(error)}`);
    }
    if (!relay?.isComplete) {
      const pending = deps.journal.get(stepId);
      if (workerReported && pending?.state === 'awaiting-upload' && pending.doneBody) {
        await resumePendingUpload(deps, pending, { ...options, failOnRejectedDone: true });
      } else {
        deps.logger.step(`Orb step exited: ${exitError}`);
        const doneBody: MachineDoneBody = { status: 'failed', errorMessage: exitError };
        deps.journal.update(stepId, { state: 'awaiting-upload', doneBody });
        try {
          await deps.client.done(stepId, doneBody);
          deps.journal.remove(stepId);
        } catch (error) {
          deps.logger.step(`Host orb failure report unreachable: ${String(error)}`);
        }
      }
    }
    if (outboxDirectory && ownsOutbox) cleanOrbOutbox(outboxDirectory);
    stop.settle();
  }
}

export async function relayOrbStopped(deps: RunStepDeps, handle: OrbHandle): Promise<void> {
  if (!handle.lastStepId) return;
  const transcript = new TranscriptBuffer(deps.paths.outboxDir, handle.lastStepId);
  const note = orbNote('orb: stopped');
  const row = {
    id: `orb-stopped-${handle.lastStepId}`,
    role: 'system' as const,
    content: `.agents/${note.name} hook ok (${note.ms}ms)\n${note.output}`,
    createdAt: Date.now(),
  };
  transcript.upsert(row);
  await deps.client.transcriptRow?.(handle.lastStepId, row);
}
