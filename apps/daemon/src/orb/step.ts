import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentSessionHandle, ClaimedStep, MachineDoneBody } from '@cairn/shared';
import { TranscriptBuffer } from '../journal.js';
import { MachineApiError } from '../machine-client.js';
import { writePrivateFile } from '../private-fs.js';
import { type RunStepDeps, type RunStepOptions, resumePendingUpload, runStep } from '../runner.js';
import { StepStops } from '../step-stops.js';
import type { OrbLifecycle } from './lifecycle.js';
import {
  ORB_STEP_METHODS,
  type OrbFrame,
  type OrbStepInput,
  orbCheckpointSchema,
} from './protocol.js';
import { type OrbExecOptions, type OrbHandle, orbNote } from './provider.js';
import { RelayMachineServer } from './relay.js';
import { prepareOrbSeed } from './seed.js';

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
  if (!/^[a-zA-Z0-9-]+$/.test(stepId)) throw new Error('Invalid orb step id');
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
  let exitError = 'Orb worker exited without completing the step';
  const execController = new AbortController();
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let providerStop: Promise<void> | undefined;
  let activeHandle: OrbHandle | undefined;
  let timedOut = false;
  const seedDirectory = join(deps.paths.home, 'orb', `${stepId}-seed`);
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
        execController.abort();
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
        const methods = ORB_STEP_METHODS.filter((method) => deps.client[method] !== undefined);
        const input: OrbStepInput = {
          claimed,
          options: { ...options, hookNotes: handle.notes.splice(0), orbStartedAt },
          machineName: deps.machineName,
          methods,
        };
        const socketPath = join(deps.paths.home, 'orb', `${stepId}.sock`);
        const binds: NonNullable<OrbExecOptions['binds']>[number][] = [
          { source: socketPath, target: '/run/cairn/relay.sock', releaseAfterExec: true },
          {
            source: import.meta.url.endsWith('.ts')
              ? join(dirname(fileURLToPath(import.meta.url)), '../../dist')
              : dirname(fileURLToPath(import.meta.url)),
            target: '/opt/cairn/daemon',
            readonly: true,
          },
        ];
        const projectId = claimed.project?.id;
        if (projectId && !/^[a-zA-Z0-9-]+$/.test(projectId))
          throw new Error('Invalid orb project id');
        const seed =
          claimed.project?.repo?.kind === 'local'
            ? claimed.project.repo.cloneUrl
            : projectId
              ? join(deps.workspacesDir, projectId, 'repo')
              : null;
        if (seed && projectId && existsSync(seed)) {
          rmSync(seedDirectory, { recursive: true, force: true });
          binds.push(await prepareOrbSeed({ source: seed, directory: seedDirectory, projectId }));
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
          if (frame.type === 'log') {
            deps.logger.step(frame.message);
            return;
          }
        };
        relay = new RelayMachineServer({
          socketPath,
          stepId,
          machineId: claimed.step.machineId ?? undefined,
          upstream: deps.client,
          input: () => ({
            ...input,
            options: { ...input.options, stopRequest: stop.request ?? undefined },
          }),
          onFrame: receive,
          onActivity: () => watchdog?.refresh(),
          onReporting: (body) => {
            workerReported = true;
            deps.journal.update(stepId, {
              state: 'awaiting-upload',
              doneBody: body,
            });
          },
          onDone: () => {
            clearTimeout(watchdog);
            deps.journal.remove(stepId);
            rmSync(join(deps.paths.outboxDir, `step-${stepId}.session.jsonl`), { force: true });
          },
        });
        await relay.listen();
        void stop.attach(session).catch((error: unknown) => deps.logger.step(String(error)));
        input.options.stopRequest = stop.request ?? undefined;
        const proxyUrl = deps.orbProxyUrl;
        watchdog = setTimeout(() => {
          timedOut = true;
          exitError = 'orb heartbeat timeout';
          void relay?.close();
          execController.abort();
          providerStop ??= lifecycle.provider.stop(handle).catch((error: unknown) => {
            deps.logger.step(`Orb stop failed: ${String(error)}`);
          });
        }, deps.orbHeartbeatTimeoutMs ?? ORB_HEARTBEAT_TIMEOUT_MS);
        watchdog.unref?.();
        try {
          const result = await lifecycle.provider.exec(
            handle,
            ['node', '/opt/cairn/daemon/cli.mjs', 'orb-step', '--socket', '/run/cairn/relay.sock'],
            {
              binds,
              signal: execController.signal,
              env: {
                ...options.env,
                CAIRN_ORB: '1',
                ...(proxyUrl ? { HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl } : {}),
              },
              onStderr: (chunk) => deps.logger.step(chunk.trimEnd()),
            },
          );
          if (!timedOut) exitError = `orb exited with code ${result.code}`;
          if (result.code !== 0 || failure) {
            deps.logger.step(`Orb step exited (${result.code}): ${failure ?? result.stderr}`);
          }
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
    await relay?.close();
    if (!relay?.isComplete) {
      const pending = deps.journal.get(stepId);
      if (workerReported && pending?.state === 'awaiting-upload' && pending.doneBody) {
        await resumePendingUpload(deps, pending, { ...options, failOnRejectedDone: true });
      } else {
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
    rmSync(seedDirectory, { recursive: true, force: true });
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
