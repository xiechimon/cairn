import type { AgentBackend, AgentSessionHandle } from '@cairn/shared';
import { createGeminiBackend } from '../backend/acp.js';
import { createClaudeCodeBackend } from '../backend/claude-code.js';
import { createPiBackend } from '../backend/pi.js';
import { StepJournal, TranscriptBuffer } from '../journal.js';
import { createDaemonLogger } from '../log.js';
import { setupProxy } from '../proxy.js';
import { runStep } from '../runner.js';
import { readSessionJsonlForUpload } from '../session-jsonl.js';
import { ensureStateDirs, recordSession, resolveSessionFile, statePaths } from '../state.js';
import { StepStops, type StopRequest } from '../step-stops.js';
import { WorkspaceManager } from '../workspace.js';
import type { OrbFrame } from './protocol.js';
import { RelayMachineApi } from './relay.js';

export async function runOrbWorker(options: {
  socketPath: string;
  backendFor?: (provider: string | null | undefined) => AgentBackend;
  home?: string;
  workspacesRoot?: string;
  seedRoot?: string;
}): Promise<void> {
  let relay: RelayMachineApi | undefined;
  const send = (frame: OrbFrame) => relay?.send(frame);
  const sessions = new (class extends Map<string, AgentSessionHandle> {
    override set(key: string, value: AgentSessionHandle): this {
      super.set(key, value);
      send({ type: 'session', live: true });
      return this;
    }
    override delete(key: string): boolean {
      const deleted = super.delete(key);
      if (deleted) send({ type: 'session', live: false });
      return deleted;
    }
  })();
  const stops = new StepStops();
  let activeStep: string | null = null;
  let stopRequest: StopRequest | undefined;
  relay = await RelayMachineApi.connect(
    options.socketPath,
    (frame) => {
      if (frame.type === 'stop') {
        stopRequest = { discard: frame.discard };
        if (activeStep)
          void stops
            .get(activeStep)
            ?.deliver(stopRequest)
            .catch((error: unknown) => send({ type: 'log', message: String(error) }));
      } else if (frame.type === 'steer' && activeStep) {
        const session = sessions.get(activeStep);
        void (
          session
            ? session.steer(frame.text, frame.images)
            : Promise.reject(new Error('No live orb session'))
        ).then(
          () => send({ type: 'steered', id: frame.id }),
          (error: unknown) => send({ type: 'steered', id: frame.id, error: String(error) }),
        );
      }
    },
    () => {
      if (activeStep)
        void stops
          .get(activeStep)
          ?.deliver({ discard: false })
          .catch(() => {});
    },
  );
  try {
    const input = await relay.input;
    const client = relay.api;
    activeStep = input.claimed.step.id;
    const logger = new Proxy(createDaemonLogger({}), {
      get:
        () =>
        (...args: string[]) =>
          send({ type: 'log', message: args.at(-1) ?? '' }),
    });
    setupProxy(logger);
    const workspacesDir = options.workspacesRoot ?? '/work';
    const paths = statePaths(options.home ?? '/home/agent/.cairn', workspacesDir);
    ensureStateDirs(paths);
    const backends = new Map<string, AgentBackend>();
    const backendFor =
      options.backendFor ??
      ((provider: string | null | undefined): AgentBackend => {
        const runtime = provider === 'claude-code' || provider === 'gemini' ? provider : 'pi';
        const existing = backends.get(runtime);
        if (existing) return existing;
        const backend =
          runtime === 'gemini'
            ? createGeminiBackend()
            : runtime === 'claude-code'
              ? createClaudeCodeBackend({
                  skills: { skillsDir: '', cwd: paths.home },
                  teamSkillsCacheDir: paths.teamSkillsCacheDir,
                })
              : createPiBackend({
                  agentDir: paths.agentRuntimeDir,
                  sessionDir: paths.chatSessionsDir,
                  skills: { skillsDir: '', cwd: paths.home },
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
        journal: new (class extends StepJournal {
          override update(...args: Parameters<StepJournal['update']>) {
            const entry = super.update(...args);
            if (entry)
              send({
                type: 'checkpoint',
                checkpoint: {
                  state: entry.state,
                  sessionId: entry.sessionId,
                  sessionAction: entry.sessionAction,
                  prompt: entry.prompt,
                  doneBody: entry.doneBody,
                  planContent: entry.planContent,
                  ...(entry.state === 'awaiting-upload' && entry.doneBody != null
                    ? {
                        transcript: new TranscriptBuffer(
                          paths.outboxDir,
                          input.claimed.step.id,
                        ).messages(),
                        sessionContent: readSessionJsonlForUpload(
                          entry.sessionFile ?? undefined,
                          (message) => logger.step(message),
                        ),
                      }
                    : {}),
                },
              });
            return entry;
          }
        })(paths.outboxDir),
        workspacesDir,
        mcpConfigPath: '/home/agent/.cairn/mcp.json',
        machineName: input.machineName,
        workspace: new WorkspaceManager({
          logger,
          hookTimeoutMs: input.hookTimeoutMs,
          seedRoot: options.seedRoot ?? '/seed',
        }),
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
    send({ type: 'finished' });
  } catch (error) {
    send({ type: 'failed', error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    relay.close();
  }
}
