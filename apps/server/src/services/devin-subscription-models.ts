import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type DevinSubscriptionModel,
  devinVariantEffort,
  THINKING_LEVELS,
  type ThinkingLevel,
} from '@cairn/shared';
import {
  childEnv,
  collectLines,
  DEFAULT_DEVIN_TIMEOUT_MS,
  devinBin,
  errorReason,
} from './devin-cli.js';

const MAX_MODEL_UPDATE_WAIT_MS = 2_000;
const MAX_CATALOG_GRACE_MS = 2_000;
const MAX_MODELS = 2000;
const MAX_MODEL_ID_LENGTH = 256;
const MAX_MODEL_NAME_LENGTH = 256;
const MODELS_LIST_ARGS = ['models', 'list', '--format', 'json', '--process-model', 'in-process'];
const SUPPORTS_IMAGES_META = 'cognition.ai/supportsImages';

type Reason = 'auth' | 'timeout' | 'unavailable' | 'failed';
type Failure = { ok: false; reason: Reason };
export type DevinSubscriptionModelsResult =
  | { ok: true; models: DevinSubscriptionModel[] }
  | Failure;

interface CatalogVariant {
  family?: string;
  costTier?: string;
  costSummary?: string;
  contextTokens?: number;
  isNew?: boolean;
  isBeta?: boolean;
  thinkingLevels?: ThinkingLevel[];
  thinkingDefault?: ThinkingLevel;
}

interface AcpModelOption {
  value: string;
  name: string;
  supportsImages?: boolean;
}

function failure(text: string): Failure {
  return { ok: false, reason: errorReason(text).reason ?? 'failed' };
}

function acpFailure(error: { code?: number; message?: string }): Failure {
  return error.code === -32000 ? { ok: false, reason: 'auth' } : failure(error.message ?? '');
}

function stringOf(value: unknown, max: number, token: string): string | undefined {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= max &&
    !value.includes(token)
    ? value
    : undefined;
}

function parseCatalog(stdout: string, token: string): Map<string, CatalogVariant> {
  const meta = new Map<string, CatalogVariant>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return meta;
  }
  const families =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as { families?: unknown }).families
      : undefined;
  if (!Array.isArray(families)) return meta;
  for (const family of families) {
    if (typeof family !== 'object' || family === null) continue;
    const familyLabel = stringOf((family as { family_label?: unknown }).family_label, 256, token);
    const variants = (family as { variants?: unknown }).variants;
    if (!Array.isArray(variants)) continue;
    const siblingLevels = new Map<string, Set<ThinkingLevel>>();
    for (const variant of variants) {
      if (typeof variant !== 'object' || variant === null) continue;
      const uid = stringOf(
        (variant as Record<string, unknown>).model_uid,
        MAX_MODEL_ID_LENGTH,
        token,
      );
      if (uid === undefined) continue;
      const effort = devinVariantEffort(uid);
      if (effort === null) continue;
      const set = siblingLevels.get(effort.baseId) ?? new Set<ThinkingLevel>();
      set.add(effort.level);
      siblingLevels.set(effort.baseId, set);
    }
    for (const variant of variants) {
      if (typeof variant !== 'object' || variant === null) continue;
      const record = variant as Record<string, unknown>;
      const uid = stringOf(record.model_uid, MAX_MODEL_ID_LENGTH, token);
      if (uid === undefined || meta.has(uid)) continue;
      const variantMeta: CatalogVariant = {};
      if (familyLabel !== undefined) variantMeta.family = familyLabel;
      const costTier = stringOf(record.cost_tier, 256, token);
      if (costTier !== undefined) variantMeta.costTier = costTier;
      const costSummary = stringOf(record.cost_summary, 512, token);
      if (costSummary !== undefined) variantMeta.costSummary = costSummary;
      if (
        typeof record.max_context_tokens === 'number' &&
        Number.isInteger(record.max_context_tokens) &&
        record.max_context_tokens > 0
      ) {
        variantMeta.contextTokens = record.max_context_tokens;
      }
      if (typeof record.is_new === 'boolean') variantMeta.isNew = record.is_new;
      if (typeof record.is_beta === 'boolean') variantMeta.isBeta = record.is_beta;
      const effort = devinVariantEffort(uid);
      const levels = effort === null ? undefined : siblingLevels.get(effort.baseId);
      if (effort !== null && levels !== undefined && levels.size >= 2) {
        variantMeta.thinkingLevels = THINKING_LEVELS.filter((level) => levels.has(level));
        variantMeta.thinkingDefault = effort.level;
      }
      meta.set(uid, variantMeta);
    }
  }
  return meta;
}

function listCatalog(
  home: string,
  token: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<Map<string, CatalogVariant>> {
  return new Promise((resolve) => {
    const bin = devinBin(MODELS_LIST_ARGS);
    const child = spawn(bin.command, bin.args, {
      cwd: home,
      env: childEnv(home, token),
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    let settled = false;
    let stdout = '';
    const finish = (meta: Map<string, CatalogVariant>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      child.kill('SIGKILL');
      resolve(meta);
    };
    const onAbort = () => finish(new Map());
    const timer = setTimeout(onAbort, timeoutMs);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    child.on('error', () => finish(new Map()));
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.on('close', (code) => finish(code === 0 ? parseCatalog(stdout, token) : new Map()));
  });
}

function modelOptionsOf(configOptions: unknown, token: string): AcpModelOption[] {
  if (!Array.isArray(configOptions)) return [];
  const options: AcpModelOption[] = [];
  for (const option of configOptions) {
    if (typeof option !== 'object' || option === null) continue;
    const record = option as { category?: unknown; type?: unknown; options?: unknown };
    if (record.category !== 'model' || record.type !== 'select' || !Array.isArray(record.options)) {
      continue;
    }
    for (const entry of record.options) {
      if (typeof entry !== 'object' || entry === null) continue;
      const candidates =
        'value' in entry ? [entry] : ((entry as { options?: unknown }).options ?? []);
      if (!Array.isArray(candidates)) continue;
      for (const candidate of candidates) {
        if (typeof candidate !== 'object' || candidate === null) continue;
        const { value, name, _meta } = candidate as {
          value?: unknown;
          name?: unknown;
          _meta?: unknown;
        };
        const id = stringOf(value, MAX_MODEL_ID_LENGTH, token);
        if (id === undefined) continue;
        const label = typeof name === 'string' && name !== '' ? name : id;
        if (stringOf(label, MAX_MODEL_NAME_LENGTH, token) === undefined) continue;
        const supportsImages =
          typeof _meta === 'object' && _meta !== null
            ? (_meta as Record<string, unknown>)[SUPPORTS_IMAGES_META]
            : undefined;
        options.push({
          value: id,
          name: label,
          ...(typeof supportsImages === 'boolean' ? { supportsImages } : {}),
        });
      }
    }
  }
  return options;
}

function acpModelOptions(
  home: string,
  token: string,
  timeoutMs: number,
  updateWaitMs: number,
): Promise<{ ok: true; options: AcpModelOption[] } | Failure> {
  return new Promise((resolve) => {
    const bin = devinBin(['acp', '--process-model', 'in-process']);
    const child = spawn(bin.command, bin.args, {
      cwd: home,
      env: childEnv(home, token),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let settled = false;
    let sessionId: string | undefined;
    let updateDeadline: ReturnType<typeof setTimeout> | undefined;
    let output = '';
    let buffer = '';
    const byValue = new Map<string, AcpModelOption>();
    const bufferedUpdates = new Map<string, AcpModelOption[]>();
    const merge = (options: AcpModelOption[]) => {
      for (const option of options) {
        if (byValue.size >= MAX_MODELS) break;
        if (!byValue.has(option.value)) byValue.set(option.value, option);
      }
    };
    const finish = (result: { ok: true; options: AcpModelOption[] } | Failure) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(updateDeadline);
      child.kill('SIGKILL');
      resolve(result);
    };
    const finishOptions = () =>
      finish(
        byValue.size > 0
          ? { ok: true, options: [...byValue.values()] }
          : { ok: false, reason: 'failed' },
      );
    const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), timeoutMs);
    const write = (id: number, method: string, params: unknown) => {
      try {
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      } catch {
        finish({ ok: false, reason: 'failed' });
      }
    };
    const onMessage = (line: string) => {
      let message: {
        id?: number;
        method?: string;
        params?: {
          sessionId?: unknown;
          update?: { sessionUpdate?: unknown; configOptions?: unknown };
        };
        result?: { authMethods?: { id?: unknown }[]; sessionId?: unknown; configOptions?: unknown };
        error?: { code?: number; message?: string };
      };
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.method === 'session/update') {
        const update = message.params?.update;
        const updateSession = message.params?.sessionId;
        if (update?.sessionUpdate !== 'config_option_update' || typeof updateSession !== 'string') {
          return;
        }
        const options = modelOptionsOf(update.configOptions, token);
        if (options.length === 0) return;
        if (sessionId === undefined) {
          if (bufferedUpdates.has(updateSession) || bufferedUpdates.size < 16) {
            bufferedUpdates.set(
              updateSession,
              [...(bufferedUpdates.get(updateSession) ?? []), ...options].slice(0, MAX_MODELS),
            );
          }
        } else if (sessionId === updateSession) {
          merge(options);
        }
        return;
      }
      if (message.id === 1) {
        if (message.error !== undefined) {
          finish(acpFailure(message.error));
          return;
        }
        const methods = (message.result?.authMethods ?? [])
          .map((method) => method.id)
          .filter((id): id is string => typeof id === 'string');
        const methodId = methods.find((id) => /devin|key|token/i.test(id)) ?? methods[0] ?? null;
        if (methodId !== null) {
          write(2, 'authenticate', { methodId, _meta: { api_key: token } });
        } else {
          write(3, 'session/new', { cwd: home, mcpServers: [] });
        }
        return;
      }
      if (message.id === 2) {
        if (message.error !== undefined) {
          finish(acpFailure(message.error));
          return;
        }
        write(3, 'session/new', { cwd: home, mcpServers: [] });
        return;
      }
      if (message.id === 3) {
        if (message.error !== undefined) {
          finish(acpFailure(message.error));
          return;
        }
        const openedSessionId = message.result?.sessionId;
        if (typeof openedSessionId !== 'string' || openedSessionId === '') {
          finish({ ok: false, reason: 'failed' });
          return;
        }
        sessionId = openedSessionId;
        merge(modelOptionsOf(message.result?.configOptions, token));
        const earlier = bufferedUpdates.get(sessionId);
        if (earlier !== undefined) merge(earlier);
        updateDeadline = setTimeout(finishOptions, updateWaitMs);
      }
    };
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish({ ok: false, reason: error.code === 'ENOENT' ? 'unavailable' : 'failed' });
    });
    child.stdin.on('error', () => finish({ ok: false, reason: 'failed' }));
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      if (settled) return;
      const { lines, rest } = collectLines(buffer + chunk);
      buffer = rest;
      for (const line of lines) {
        if (settled) return;
        if (line.trim() !== '') onMessage(line);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.on('close', (code) => {
      if (sessionId !== undefined && code === 0) {
        finishOptions();
        return;
      }
      finish(code === 0 ? { ok: false, reason: 'failed' } : failure(output));
    });
    write(1, 'initialize', {
      protocolVersion: 1,
      clientCapabilities: { session: {}, fs: { readTextFile: false, writeTextFile: false } },
    });
  });
}

export async function fetchDevinSubscriptionModels(
  token: string,
  options: { timeoutMs?: number; updateWaitMs?: number; catalogGraceMs?: number } = {},
): Promise<DevinSubscriptionModelsResult> {
  const home = await mkdtemp(join(tmpdir(), 'cairn-devin-models-'));
  const catalogController = new AbortController();
  try {
    const configDir = join(home, '.local', 'share', 'devin');
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, 'credentials.toml'), `windsurf_api_key = "${token}"\n`, {
      mode: 0o600,
    });
    const timeoutMs = options.timeoutMs ?? DEFAULT_DEVIN_TIMEOUT_MS;
    const catalogPromise = listCatalog(home, token, timeoutMs, catalogController.signal);
    const acp = await acpModelOptions(
      home,
      token,
      timeoutMs,
      options.updateWaitMs ?? MAX_MODEL_UPDATE_WAIT_MS,
    );
    if (!acp.ok) {
      catalogController.abort();
      return acp;
    }
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const catalog = await Promise.race([
      catalogPromise,
      new Promise<Map<string, CatalogVariant>>((resolve) => {
        graceTimer = setTimeout(
          () => resolve(new Map()),
          options.catalogGraceMs ?? MAX_CATALOG_GRACE_MS,
        );
      }),
    ]).finally(() => clearTimeout(graceTimer));
    const models = acp.options.map((option) => {
      const variant = catalog.get(option.value);
      return {
        id: option.value,
        name: option.name,
        ...(variant ?? {}),
        ...(option.supportsImages !== undefined ? { supportsImages: option.supportsImages } : {}),
      };
    });
    return { ok: true, models: models.slice(0, MAX_MODELS) };
  } finally {
    catalogController.abort();
    await rm(home, { recursive: true, force: true });
  }
}
