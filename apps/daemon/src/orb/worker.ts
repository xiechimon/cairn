import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type AgentBackend, type AgentSessionHandle, conversationBranch } from '@cairn/shared';
import { createGeminiBackend } from '../backend/acp.js';
import { createClaudeCodeBackend } from '../backend/claude-code.js';
import { createPiBackend } from '../backend/pi.js';
import { runGitOk } from '../git.js';
import { StepJournal, TranscriptBuffer } from '../journal.js';
import { createDaemonLogger } from '../log.js';
import { setupProxy } from '../proxy.js';
import { runStep } from '../runner.js';
import { readSessionJsonlForUpload } from '../session-jsonl.js';
import { ensureStateDirs, recordSession, resolveSessionFile, statePaths } from '../state.js';
import { StepStops, type StopRequest } from '../step-stops.js';
import { WorkspaceManager } from '../workspace.js';
import { type OrbFrame, orbReleaseKeySchema } from './protocol.js';
import { OrbStaleReleaseError, RelayMachineApi } from './relay.js';

export async function runOrbWorker(options: {
  socketPath: string;
  entryPath?: string;
  backendFor?: (provider: string | null | undefined) => AgentBackend;
  home?: string;
  workspacesRoot?: string;
  seedRoot?: string;
  outboxRoot?: string;
}): Promise<void> {
  const entry = realpathSync(options.entryPath ?? fileURLToPath(import.meta.url));
  const directory = dirname(entry);
  const releaseRoot = dirname(directory);
  if (
    basename(entry) !== 'cli.mjs' ||
    basename(directory) !== 'dist' ||
    basename(dirname(releaseRoot)) !== 'releases'
  )
    throw new Error('Orb worker entry must resolve to releases/<key>/dist/cli.mjs');
  const release = orbReleaseKeySchema.parse(basename(releaseRoot));
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
  while (!existsSync(options.socketPath) || !existsSync(`${options.socketPath}.token`))
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  try {
    relay = await RelayMachineApi.connect(
      options.socketPath,
      release,
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
  } catch (error) {
    if (!(error instanceof OrbStaleReleaseError)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 75;
    return;
  }
  try {
    const input = await relay.input;
    const connection = relay;
    const client = relay.api;
    activeStep = input.claimed.step.id;
    const logger = new Proxy(createDaemonLogger({}), {
      get:
        () =>
        (...args: string[]) =>
          send({ type: 'log', message: args.at(-1) ?? '' }),
    });
    setupProxy(logger, { ...process.env, ...input.options.env });
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
        workspace: new (class extends WorkspaceManager {
          override async push(...args: Parameters<WorkspaceManager['push']>): Promise<void> {
            if (input.claimed.project?.repo?.kind !== 'local') return super.push(...args);
            const [cwd, branch] = args;
            if (branch !== conversationBranch(input.claimed.conversationId))
              throw new Error('Local bundle branch does not match claimed Thread');
            const filename = `${randomUUID()}.bundle`;
            const bundle = join(options.outboxRoot ?? '/run/cairn/outbox', filename);
            try {
              await runGitOk(['bundle', 'create', bundle, `refs/heads/${branch}`], {
                cwd,
                timeoutMs: 120_000,
              });
              await connection.call('deliverBundle', [input.claimed.step.id, filename]);
            } finally {
              rmSync(bundle, { force: true });
            }
          }
        })({
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
