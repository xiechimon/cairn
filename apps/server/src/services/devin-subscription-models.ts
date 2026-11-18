import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DevinSubscriptionModel } from '@cairn/shared';
import {
  childEnv,
  collectLines,
  DEFAULT_DEVIN_TIMEOUT_MS,
  devinBin,
  errorReason,
} from './devin-cli.js';

const SETTLE_MS = 2_000;
const MAX_MODELS = 2000;
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
}

interface AcpModelOption {
  value: string;
  name: string;
  supportsImages?: boolean;
}

function failure(text: string): Failure {
  return { ok: false, reason: errorReason(text).reason ?? 'failed' };
}

function stringOf(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined;
}

function parseCatalog(stdout: string): Map<string, CatalogVariant> {
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
    const familyLabel = stringOf((family as { family_label?: unknown }).family_label, 256);
    const variants = (family as { variants?: unknown }).variants;
    if (!Array.isArray(variants)) continue;
    for (const variant of variants) {
      if (typeof variant !== 'object' || variant === null) continue;
      const record = variant as Record<string, unknown>;
      const uid = stringOf(record.model_uid, 256);
      if (uid === undefined || meta.has(uid)) continue;
      const variantMeta: CatalogVariant = {};
      if (familyLabel !== undefined) variantMeta.family = familyLabel;
      const costTier = stringOf(record.cost_tier, 256);
      if (costTier !== undefined) variantMeta.costTier = costTier;
      const costSummary = stringOf(record.cost_summary, 512);
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
      meta.set(uid, variantMeta);
    }
  }
  return meta;
}

function listCatalog(
  home: string,
  token: string,
  timeoutMs: number,
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
      child.kill('SIGKILL');
      resolve(meta);
    };
    const timer = setTimeout(() => finish(new Map()), timeoutMs);
    child.on('error', () => finish(new Map()));
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.on('close', (code) => finish(code === 0 ? parseCatalog(stdout) : new Map()));
  });
}

function modelOptionsOf(configOptions: unknown): AcpModelOption[] {
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
        if (typeof value !== 'string' || value === '') continue;
        const supportsImages =
          typeof _meta === 'object' && _meta !== null
            ? (_meta as Record<string, unknown>)[SUPPORTS_IMAGES_META]
            : undefined;
        options.push({
          value,
          name: typeof name === 'string' && name !== '' ? name : value,
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
  settleMs: number,
): Promise<{ ok: true; options: AcpModelOption[] } | Failure> {
  return new Promise((resolve) => {
    const bin = devinBin(['acp']);
    const child = spawn(bin.command, bin.args, {
      cwd: home,
      env: childEnv(home, token),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let settled = false;
    let sessionOpened = false;
    let settle: ReturnType<typeof setTimeout> | undefined;
    let output = '';
    let buffer = '';
    const byValue = new Map<string, AcpModelOption>();
    const merge = (configOptions: unknown) => {
      for (const option of modelOptionsOf(configOptions)) {
        if (!byValue.has(option.value)) byValue.set(option.value, option);
      }
    };
    const finish = (result: { ok: true; options: AcpModelOption[] } | Failure) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (settle !== undefined) clearTimeout(settle);
      child.kill('SIGKILL');
      resolve(result);
    };
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
        params?: { update?: { sessionUpdate?: unknown; configOptions?: unknown } };
        result?: { authMethods?: { id?: unknown }[]; configOptions?: unknown };
        error?: { code?: number; message?: string };
      };
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.method === 'session/update') {
        const update = message.params?.update;
        if (update?.sessionUpdate === 'config_option_update') merge(update.configOptions);
        return;
      }
      if (message.id === 1) {
        if (message.error !== undefined) {
          finish(failure(message.error.message ?? ''));
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
          finish(failure(message.error.message ?? ''));
          return;
        }
        write(3, 'session/new', { cwd: home, mcpServers: [] });
        return;
      }
      if (message.id === 3) {
        if (message.error !== undefined) {
          finish(failure(message.error.message ?? ''));
          return;
        }
        sessionOpened = true;
        merge(message.result?.configOptions);
        settle = setTimeout(() => finish({ ok: true, options: [...byValue.values()] }), settleMs);
      }
    };
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish({ ok: false, reason: error.code === 'ENOENT' ? 'unavailable' : 'failed' });
    });
    child.stdout.on('data', (chunk: Buffer) => {
      const { lines, rest } = collectLines(buffer + chunk.toString('utf8'));
      buffer = rest;
      for (const line of lines) {
        if (line.trim() !== '') onMessage(line);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.on('close', (code) => {
      if (sessionOpened) {
        finish({ ok: true, options: [...byValue.values()] });
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
  options: { timeoutMs?: number; settleMs?: number } = {},
): Promise<DevinSubscriptionModelsResult> {
  const home = await mkdtemp(join(tmpdir(), 'cairn-devin-models-'));
  try {
    const configDir = join(home, '.local', 'share', 'devin');
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, 'credentials.toml'), `windsurf_api_key = "${token}"\n`, {
      mode: 0o600,
    });
    const timeoutMs = options.timeoutMs ?? DEFAULT_DEVIN_TIMEOUT_MS;
    const [catalog, acp] = await Promise.all([
      listCatalog(home, token, timeoutMs),
      acpModelOptions(home, token, timeoutMs, options.settleMs ?? SETTLE_MS),
    ]);
    if (!acp.ok) return acp;
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
    await rm(home, { recursive: true, force: true });
  }
}
