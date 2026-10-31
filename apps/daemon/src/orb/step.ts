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
  decodeOrbFrame,
  encodeOrbFrame,
  ORB_STEP_METHODS,
  type OrbFrame,
  type OrbStepInput,
  orbCheckpointSchema,
} from './protocol.js';
import { type OrbHandle, orbNote } from './provider.js';

export async function runOrbStep(
  lifecycle: OrbLifecycle,
  deps: RunStepDeps,
  claimed: ClaimedStep,
  options: RunStepOptions = {},
): Promise<void> {
  if (lifecycle.provider.kind === 'host') {
    const env = { ...options.env };
    delete env.CAIRN_ORB;
    await runStep(deps, claimed, { ...options, env });
    return;
  }
  const stepId = claimed.step.id;
  const stepPaths = { ...deps.paths, outboxDir: join(deps.paths.home, 'orb-outbox', stepId) };
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
  const completion: { reported: boolean; reporting: Promise<unknown> | null } = {
    reported: false,
    reporting: null,
  };
  let write: (data: string) => void = () => {};
  let ready = false;
  let ended = false;
  let nextSteer = 0;
  const waiting = new Set<{ resolve: () => void; reject: (error: Error) => void }>();
  const steering = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();
  const send = (frame: OrbFrame) => write(encodeOrbFrame(frame));
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
        handle.lastStepId = stepId;
        lifecycle.provider.touch(handle, Date.now());
        const methods = ORB_STEP_METHODS.filter((method) => deps.client[method] !== undefined);
        const paths = {
          ...stepPaths,
          chatSessionsDir: join(deps.paths.chatSessionsDir, handle.id),
          agentRuntimeDir: join(deps.paths.agentRuntimeDir, handle.id),
          teamSkillsCacheDir: join(deps.paths.teamSkillsCacheDir, handle.id),
          workspacesDir: join(deps.workspacesDir, '.orbs', handle.id),
        };
        const input: OrbStepInput = {
          claimed,
          options: { ...options, hookNotes: handle.notes.splice(0), orbStartedAt },
          paths,
          workspacesDir: paths.workspacesDir,
          mcpConfigPath: deps.mcpConfigPath,
          skillsDir: deps.skillsDir,
          machineName: deps.machineName,
          methods,
        };
        const directories = [
          paths.outboxDir,
          paths.chatSessionsDir,
          paths.agentRuntimeDir,
          paths.teamSkillsCacheDir,
          join(paths.stepAttachmentsDir, stepId),
          join(paths.plansDir, claimed.conversationId),
          join(paths.reportsDir, claimed.conversationId),
          paths.workspacesDir,
        ];
        for (const dir of directories) mkdirSync(dir, { recursive: true });
        const binds: {
          source: string;
          target: string;
          readonly?: boolean;
          releaseAfterExec?: boolean;
        }[] = directories.map((source) => ({
          source,
          target: source,
          ...(source === paths.outboxDir ? { releaseAfterExec: true } : {}),
        }));
        for (const source of [deps.skillsDir, deps.mcpConfigPath]) {
          if (source && existsSync(source)) binds.push({ source, target: source, readonly: true });
        }
        const localPath =
          claimed.project?.repo?.kind === 'local' ? claimed.project.repo.cloneUrl : null;
        if (localPath && existsSync(localPath))
          binds.push({ source: localPath, target: localPath });
        let buffer = '';
        let finished = false;
        let failure: string | null = null;
        const requests = new Map<number, AbortController>();
        const uploads = new Set<string>();
        const receive = async (frame: OrbFrame): Promise<void> => {
          if (frame.type === 'checkpoint') {
            const parsed = orbCheckpointSchema.safeParse(frame.checkpoint);
            if (parsed.success && !completion.reported) {
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
          if (frame.type === 'finished') {
            finished = true;
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
          if (frame.type === 'cancel') {
            requests.get(frame.id)?.abort();
            return;
          }
          if (frame.type !== 'call') return;
          const controller = new AbortController();
          requests.set(frame.id, controller);
          try {
            if (!methods.includes(frame.method)) throw new Error('Orb API method is unavailable');
            if (
              !['putUpload', 'reportClaudeRateLimit'].includes(frame.method) &&
              frame.args[0] !== stepId
            )
              throw new Error('Orb API step does not match claim');
            if (frame.method === 'putUpload' && !uploads.has(String(frame.args[0])))
              throw new Error('Orb upload URL was not issued for this step');
            if (frame.method === 'relayTool' || frame.method === 'askUser') {
              const index = frame.method === 'relayTool' ? 3 : 2;
              frame.args[index] = { ...(frame.args[index] as object), signal: controller.signal };
            }
            if (frame.method === 'done')
              deps.journal.update(stepId, {
                state: 'awaiting-upload',
                doneBody: frame.args[1] as MachineDoneBody,
              });
            const operation = Promise.resolve(
              Reflect.apply(
                deps.client[frame.method] as (...args: unknown[]) => unknown,
                deps.client,
                frame.args,
              ),
            );
            if (frame.method === 'done') completion.reporting = operation;
            const value: unknown = await operation;
            if (frame.method === 'done') {
              completion.reported = true;
              deps.journal.remove(stepId);
              rmSync(join(deps.paths.outboxDir, `step-${stepId}.session.jsonl`), { force: true });
            }
            if (frame.method === 'uploadUrls') {
              for (const upload of (value as { uploads: { url: string }[] }).uploads)
                uploads.add(upload.url);
            }
            send({ type: 'reply', id: frame.id, value });
          } catch (error) {
            send({
              type: 'reply',
              id: frame.id,
              error: error instanceof Error ? error.message : String(error),
              ...(error instanceof MachineApiError
                ? { status: error.status, body: error.body }
                : {}),
            });
          } finally {
            requests.delete(frame.id);
          }
        };
        input.options.stopRequest = stop.request ?? undefined;
        try {
          const execution = lifecycle.provider.exec(handle, ['cairn', 'orb-step'], {
            binds,
            env: { ...options.env, CAIRN_ORB: '1' },
            input: encodeOrbFrame({ type: 'init', input }),
            onInput: (sendInput) => {
              write = sendInput;
              void stop.attach(session).catch((error: unknown) => deps.logger.step(String(error)));
            },
            onStdout: (chunk) => {
              buffer += chunk;
              let newline = buffer.indexOf('\n');
              while (newline >= 0) {
                const frame = decodeOrbFrame(buffer.slice(0, newline));
                buffer = buffer.slice(newline + 1);
                if (frame) void receive(frame);
                newline = buffer.indexOf('\n');
              }
            },
            onStderr: (chunk) => deps.logger.step(chunk.trimEnd()),
          });
          const result = await execution;
          if (result.code !== 0 || !finished || failure)
            throw new Error(failure ?? `Orb step exited (${result.code}): ${result.stderr}`);
        } finally {
          for (const request of requests.values()) request.abort();
        }
      },
    );
  } catch (error) {
    clearInterval(heartbeat);
    if (completion.reporting) await completion.reporting.catch(() => {});
    if (!completion.reported) {
      const pending = deps.journal.get(stepId);
      if (pending?.state === 'awaiting-upload' && pending.doneBody) {
        await resumePendingUpload(deps, pending, { running: options.running });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      deps.logger.step(`step failed: ${message}`);
      const transcript = new TranscriptBuffer(deps.paths.outboxDir, stepId);
      transcript.upsert({
        id: `orb-error-${stepId}`,
        role: 'system',
        content: message,
        createdAt: Date.now(),
      });
      const entry = deps.journal.update(stepId, {
        state: 'awaiting-upload',
        doneBody: { status: 'failed', errorMessage: message },
      });
      if (entry) await resumePendingUpload(deps, entry, { running: options.running });
    }
  } finally {
    ended = true;
    const error = new Error('Orb worker ended before steer delivery');
    for (const pending of [...waiting, ...steering.values()]) pending.reject(error);
    deps.sessionHandles?.delete(stepId);
    clearInterval(heartbeat);
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
