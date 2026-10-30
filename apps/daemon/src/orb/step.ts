import { existsSync, mkdirSync } from 'node:fs';
import type { AgentSessionHandle, ClaimedStep } from '@cairn/shared';
import { TranscriptBuffer } from '../journal.js';
import { MachineApiError } from '../machine-client.js';
import { type RunStepDeps, type RunStepOptions, runStep } from '../runner.js';
import { StepStops } from '../step-stops.js';
import type { OrbLifecycle } from './lifecycle.js';
import {
  decodeOrbFrame,
  encodeOrbFrame,
  ORB_STEP_METHODS,
  type OrbFrame,
  type OrbStepInput,
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
  try {
    await lifecycle.run(
      {
        conversationId: claimed.conversationId,
        projectId: claimed.project?.id ?? claimed.conversationId,
      },
      async (handle) => {
        handle.lastStepId = stepId;
        lifecycle.provider.touch(handle, Date.now());
        let write: (data: string) => void = () => {};
        const send = (frame: OrbFrame) => write(encodeOrbFrame(frame));
        const session: AgentSessionHandle = {
          sessionId: claimed.session.sessionId ?? stepId,
          events: (async function* () {})(),
          async steer(text, images) {
            send({ type: 'steer', text, images });
          },
          async stop() {
            send({ type: 'stop', discard: stop.request?.discard ?? false });
          },
          usage: () => [],
        };
        const methods = ORB_STEP_METHODS.filter((method) => deps.client[method] !== undefined);
        const input: OrbStepInput = {
          claimed,
          options: { ...options, hookNotes: handle.notes.splice(0), orbStartedAt },
          paths: deps.paths,
          workspacesDir: deps.workspacesDir,
          mcpConfigPath: deps.mcpConfigPath,
          skillsDir: deps.skillsDir,
          machineName: deps.machineName,
          methods,
        };
        const directories = [
          deps.paths.outboxDir,
          deps.paths.chatSessionsDir,
          deps.paths.agentRuntimeDir,
          deps.paths.teamSkillsCacheDir,
          deps.paths.stepAttachmentsDir,
          deps.paths.plansDir,
          deps.paths.reportsDir,
          deps.workspacesDir,
        ];
        for (const dir of directories) mkdirSync(dir, { recursive: true });
        const binds: { source: string; target: string; readonly?: boolean }[] = directories.map(
          (source) => ({ source, target: source }),
        );
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
            const value: unknown = await Reflect.apply(
              deps.client[frame.method] as (...args: unknown[]) => unknown,
              deps.client,
              frame.args,
            );
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
        deps.sessionHandles?.set(stepId, session);
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
          deps.sessionHandles?.delete(stepId);
        }
      },
    );
  } finally {
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
