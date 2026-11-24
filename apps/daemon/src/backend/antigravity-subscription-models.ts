import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import {
  client,
  methods,
  type NewSessionResponse,
  ndJsonStream,
  PROTOCOL_VERSION,
  type SessionConfigOption,
} from '@agentclientprotocol/sdk';
import {
  ANTIGRAVITY_MODEL_NAME_MAX_LENGTH,
  type AntigravityProbedModel,
  antigravityProbedModelSchema,
  antigravitySubscriptionModelSchema,
  type MachineAntigravityModelProbeResult,
} from '@cairn/shared';
import { createCredentialProfile } from '@cairn/shared/credential-profile';
import { antigravityFileStorageEnv, writeAntigravityAuthSettings } from '../agent-config.js';
import { DAEMON_VERSION } from '../version.js';
import { type AntigravityInstall, antigravityProbeEnv } from './antigravity-managed.js';

const PROBE_TIMEOUT_MS = 30_000;
const UPDATE_IDLE_MS = 200;
const MAX_MODELS = 2000;

type ModelChoice = { value: string; name: string; group?: string };

function modelChoices(
  options: readonly SessionConfigOption[] | null | undefined,
): readonly ModelChoice[] {
  return (options ?? []).flatMap((option) =>
    option.type === 'select' && option.category === 'model'
      ? option.options.flatMap((choice) =>
          'options' in choice
            ? choice.options.map(({ value, name }) => ({ value, name, group: choice.name }))
            : [{ value: choice.value, name: choice.name }],
        )
      : [],
  );
}

async function queryAntigravityModels(
  install: Pick<AntigravityInstall, 'binPath' | 'args'>,
  { home, env }: ReturnType<typeof createCredentialProfile>,
  token: string,
  signal: AbortSignal,
): Promise<AntigravityProbedModel[]> {
  signal.throwIfAborted();
  const child = spawn(install.binPath, install.args, {
    cwd: home,
    env: {
      ...antigravityProbeEnv(process.env),
      ...env,
      ...antigravityFileStorageEnv(home),
      TMPDIR: home,
      TMP: home,
      TEMP: home,
      GEMINI_API_KEY: token,
    },
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true,
  });
  const models = new Map<string, AntigravityProbedModel>();
  const updates = new Map<string, readonly ModelChoice[]>();
  let sessionId: string | undefined;
  let updateTimer: ReturnType<typeof setTimeout> | undefined;
  let finishUpdates = () => {};
  let childClosed = false;
  const add = (id: unknown, name: unknown, group?: unknown) => {
    if (typeof name === 'string' && name.includes(token)) return;
    const parsed = antigravitySubscriptionModelSchema.safeParse({
      id,
      name:
        typeof name === 'string' && name !== ''
          ? name.slice(0, ANTIGRAVITY_MODEL_NAME_MAX_LENGTH)
          : id,
    });
    if (!parsed.success || parsed.data.id.includes(token)) return;
    const label = antigravityProbedModelSchema.shape.group.safeParse(
      typeof group === 'string' ? group.trim() : undefined,
    );
    const groupLabel =
      label.success && label.data !== undefined && !label.data.includes(token)
        ? label.data
        : undefined;
    const existing = models.get(parsed.data.id);
    if (existing !== undefined) {
      if (existing.group === undefined && groupLabel !== undefined) {
        models.set(existing.id, { ...existing, group: groupLabel });
      }
      return;
    }
    if (models.size >= MAX_MODELS) return;
    models.set(
      parsed.data.id,
      groupLabel === undefined ? parsed.data : { ...parsed.data, group: groupLabel },
    );
  };
  const extendUpdateWindow = () => {
    clearTimeout(updateTimer);
    updateTimer = setTimeout(finishUpdates, UPDATE_IDLE_MS);
  };
  const app = client({ name: 'cairn' });
  app.onNotification(methods.client.session.update, ({ params }) => {
    if (params.update.sessionUpdate !== 'config_option_update') return;
    const choices = modelChoices(params.update.configOptions);
    if (choices.length === 0) return;
    if (sessionId === undefined) {
      if (updates.has(params.sessionId) || updates.size < 16) {
        updates.set(
          params.sessionId,
          [...(updates.get(params.sessionId) ?? []), ...choices].slice(0, MAX_MODELS),
        );
      }
      return;
    }
    if (params.sessionId !== sessionId) return;
    for (const choice of choices) add(choice.value, choice.name, choice.group);
    extendUpdateWindow();
  });
  const connection = app.connect(
    ndJsonStream(
      Writable.toWeb(child.stdin),
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    ),
  );
  const closed = new Promise<void>((resolve) => {
    child.once('close', () => {
      childClosed = true;
      connection.close(new Error('Antigravity model probe exited'));
      finishUpdates();
      resolve();
    });
  });
  child.once('error', (error) => connection.close(error));
  child.stdin.on('error', (error) => connection.close(error));
  const abort = () => {
    connection.close(new Error('Antigravity model probe timed out'));
    finishUpdates();
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    const initialized = await connection.agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, session: {} },
      clientInfo: { name: 'cairn', version: DAEMON_VERSION },
    });
    if (initialized.protocolVersion !== PROTOCOL_VERSION) return [];
    const created = await connection.agent.request<NewSessionResponse>(methods.agent.session.new, {
      cwd: home,
      mcpServers: [],
    });
    if (typeof created.sessionId !== 'string' || created.sessionId === '') return [];
    sessionId = created.sessionId;
    for (const choice of modelChoices(created.configOptions))
      add(choice.value, choice.name, choice.group);
    for (const choice of updates.get(sessionId) ?? []) add(choice.value, choice.name, choice.group);
    if (!childClosed && !signal.aborted) {
      await new Promise<void>((resolve) => {
        finishUpdates = resolve;
        extendUpdateWindow();
      });
    }
    signal.throwIfAborted();
    const legacy = (created as { models?: { availableModels?: unknown } }).models?.availableModels;
    if (Array.isArray(legacy)) {
      for (const entry of legacy) {
        if (typeof entry !== 'object' || entry === null) continue;
        const { modelId, name } = entry as { modelId?: unknown; name?: unknown };
        if (typeof modelId !== 'string') continue;
        add(modelId, name);
      }
    }
    return [...models.values()];
  } finally {
    signal.removeEventListener('abort', abort);
    clearTimeout(updateTimer);
    connection.close();
    child.kill('SIGKILL');
    child.stdout.destroy();
    child.stdin.destroy();
    await closed;
  }
}

export async function probeAntigravitySubscriptionModels(
  install: Pick<AntigravityInstall, 'binPath' | 'args'>,
  token: string,
  appData: string,
  signal?: AbortSignal,
): Promise<MachineAntigravityModelProbeResult> {
  const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MS);
  const deadline = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
  let profile: ReturnType<typeof createCredentialProfile> | undefined;
  try {
    deadline.throwIfAborted();
    profile = createCredentialProfile(appData);
    writeAntigravityAuthSettings(profile.home);
    const models = await queryAntigravityModels(install, profile, token, deadline);
    return models.length > 0 ? { status: 'ok', models } : { status: 'failed', failure: 'upstream' };
  } catch (error) {
    if (deadline.aborted) return { status: 'failed', failure: 'timeout' };
    if (
      error instanceof Error &&
      /unauthorized|authentication|invalid api key|\b401\b/i.test(error.message)
    ) {
      return { status: 'failed', failure: 'auth' };
    }
    return { status: 'failed', failure: 'upstream' };
  } finally {
    profile?.cleanup();
  }
}
