import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type { AgentBackend, AgentSessionHandle } from '@cairn/shared';
import { createGeminiBackend } from '../backend/acp.js';
import { createClaudeCodeBackend } from '../backend/claude-code.js';
import { createPiBackend } from '../backend/pi.js';
import { StepJournal } from '../journal.js';
import { createDaemonLogger } from '../log.js';
import { type MachineApi, MachineApiError } from '../machine-client.js';
import { runStep } from '../runner.js';
import { recordSession, resolveSessionFile } from '../state.js';
import { StepStops, type StopRequest } from '../step-stops.js';
import { WorkspaceManager } from '../workspace.js';
import { decodeOrbFrame, encodeOrbFrame, type OrbFrame, type OrbStepInput } from './protocol.js';

export async function runOrbWorker(io: {
  input: Readable;
  output: Writable;
  backendFor?: (provider: string | null | undefined) => AgentBackend;
}): Promise<void> {
  const lines = createInterface({ input: io.input });
  const send = (frame: OrbFrame) => {
    io.output.write(encodeOrbFrame(frame));
  };
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  const sessions = new Map<string, AgentSessionHandle>();
  const stops = new StepStops();
  let nextId = 0;
  let activeStep: string | null = null;
  let stopRequest: StopRequest | undefined;
  let started = false;
  let complete: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    complete = resolve;
  });

  const execute = async (input: OrbStepInput): Promise<void> => {
    activeStep = input.claimed.step.id;
    const client = new Proxy(
      {},
      {
        get(_target, method: string) {
          if (!input.methods.includes(method as OrbStepInput['methods'][number])) return undefined;
          return async (...args: unknown[]) => {
            const id = nextId++;
            const options = args.at(-1) as { signal?: AbortSignal } | undefined;
            const cancel = () => send({ type: 'cancel', id });
            const response = new Promise<unknown>((resolve, reject) =>
              pending.set(id, { resolve, reject }),
            );
            send({ type: 'call', id, method: method as OrbStepInput['methods'][number], args });
            options?.signal?.addEventListener?.('abort', cancel, { once: true });
            try {
              const result = await response;
              if (method === 'skillFile') return Buffer.from((result as { data: number[] }).data);
              return result;
            } finally {
              options?.signal?.removeEventListener?.('abort', cancel);
            }
          };
        },
      },
    ) as MachineApi;
    const logger = new Proxy(createDaemonLogger({}), {
      get:
        () =>
        (...args: string[]) =>
          send({ type: 'log', message: args.at(-1) ?? '' }),
    });
    const paths = input.paths;
    const backends = new Map<string, AgentBackend>();
    const backendFor =
      io.backendFor ??
      ((provider: string | null | undefined): AgentBackend => {
        const runtime = provider === 'claude-code' || provider === 'gemini' ? provider : 'pi';
        const existing = backends.get(runtime);
        if (existing) return existing;
        const backend =
          runtime === 'gemini'
            ? createGeminiBackend()
            : runtime === 'claude-code'
              ? createClaudeCodeBackend({
                  skills: { skillsDir: input.skillsDir ?? '', cwd: paths.home },
                  teamSkillsCacheDir: paths.teamSkillsCacheDir,
                })
              : createPiBackend({
                  agentDir: paths.agentRuntimeDir,
                  sessionDir: paths.chatSessionsDir,
                  skills: { skillsDir: input.skillsDir ?? '', cwd: paths.home },
                  resolveSessionFile: (id) => resolveSessionFile(paths, id),
                  onSession: (id, file) => {
                    if (file) recordSession(paths, id, file);
                  },
                  machineName: input.machineName,
                });
        backends.set(runtime, backend);
        return backend;
      });
    await runStep(
      {
        client,
        logger,
        paths,
        backendFor,
        journal: new StepJournal(paths.outboxDir),
        workspacesDir: input.workspacesDir,
        mcpConfigPath: input.mcpConfigPath,
        skillsDir: input.skillsDir,
        machineName: input.machineName,
        workspace: new WorkspaceManager({ logger, hookTimeoutMs: input.hookTimeoutMs }),
        sessionHandles: sessions,
        stops,
      },
      input.claimed,
      {
        ...input.options,
        env: { ...input.options.env, CAIRN_ORB: '1' },
        ...(stopRequest ? { stopRequest } : {}),
      },
    );
  };

  lines.on('line', (line) => {
    const frame = decodeOrbFrame(line);
    if (!frame) return;
    if (frame.type === 'reply') {
      const request = pending.get(frame.id);
      pending.delete(frame.id);
      if (frame.error)
        request?.reject(
          frame.status !== undefined
            ? new MachineApiError(frame.status, frame.body ?? frame.error)
            : new Error(frame.error),
        );
      else request?.resolve(frame.value);
    } else if (frame.type === 'stop') {
      stopRequest = { discard: frame.discard };
      if (activeStep)
        void stops
          .get(activeStep)
          ?.deliver(stopRequest)
          .catch((error: unknown) => send({ type: 'log', message: String(error) }));
    } else if (frame.type === 'steer' && activeStep) {
      void sessions.get(activeStep)?.steer(frame.text, frame.images);
    } else if (frame.type === 'init' && !started) {
      started = true;
      void execute(frame.input)
        .then(
          () => send({ type: 'finished' }),
          (error: unknown) =>
            send({ type: 'failed', error: error instanceof Error ? error.message : String(error) }),
        )
        .finally(complete);
    }
  });
  lines.on('close', () => {
    for (const request of pending.values()) request.reject(new Error('Orb host connection closed'));
    if (activeStep) void stops.get(activeStep)?.deliver({ discard: false });
    complete();
  });
  await done;
  lines.close();
}
