import { z } from 'zod';
import { type ProviderApi, providerApiSchema } from './records/provider.js';

export type LocalProviderState = 'ready' | 'needs-key' | 'needs-login' | 'unsupported';

export interface LocalProvider {
  source: 'pi';
  providerId: string;
  label: string;
  api: ProviderApi | null;
  baseUrl: string;
  authHeader: boolean;
  models: { id: string; name: string }[];
  state: LocalProviderState;
}

export interface LocalProviderImport extends LocalProvider {
  apiKey: string;
}

const piModelSchema = z.object({ id: z.string().min(1), name: z.string().optional() });

const piProviderSchema = z.object({
  name: z.string().optional(),
  api: z.string().optional(),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  authHeader: z.boolean().optional(),
  models: z.array(z.unknown()).optional(),
});

const piModelsFileSchema = z.object({ providers: z.record(z.string(), z.unknown()) });

const piCredentialSchema = z.object({ type: z.string(), key: z.string().optional() });

type PiCredential = z.infer<typeof piCredentialSchema>;

const ENV_REFERENCE = /\$(?:\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_])/;

function literalKey(value: string | undefined): string | null {
  if (value === undefined || value === '' || value.startsWith('!')) return null;
  const unescaped = value.replaceAll('$$', '\u0000').replaceAll('$!', '!');
  if (ENV_REFERENCE.test(unescaped)) return null;
  return unescaped.replaceAll('\u0000', '$');
}

function credentialsOf(auth: unknown): Map<string, PiCredential> {
  const credentials = new Map<string, PiCredential>();
  if (auth === null || typeof auth !== 'object') return credentials;
  for (const [id, raw] of Object.entries(auth)) {
    const parsed = piCredentialSchema.safeParse(raw);
    if (parsed.success) credentials.set(id, parsed.data);
  }
  return credentials;
}

function httpUrl(value: string | undefined): string | null {
  if (value === undefined) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? value : null;
  } catch {
    return null;
  }
}

function keyOf(
  apiKey: string | undefined,
  credential: PiCredential | undefined,
): { login: boolean; key: string | null } {
  if (credential?.type === 'oauth') return { login: true, key: null };
  if (credential?.type === 'api_key' && credential.key !== undefined) {
    return { login: false, key: literalKey(credential.key) };
  }
  return { login: false, key: literalKey(apiKey) };
}

interface Entry {
  provider: LocalProvider;
  key: string | null;
}

function entries(models: unknown, auth: unknown): Entry[] {
  const credentials = credentialsOf(auth);
  const file = piModelsFileSchema.safeParse(models);
  const configured = file.success ? Object.entries(file.data.providers) : [];
  const out: Entry[] = [];
  for (const [providerId, raw] of configured) {
    const parsed = piProviderSchema.safeParse(raw);
    if (!parsed.success) continue;
    const config = parsed.data;
    const api = providerApiSchema.safeParse(config.api);
    const baseUrl = httpUrl(config.baseUrl);
    const providerModels = (config.models ?? []).flatMap((model) => {
      const row = piModelSchema.safeParse(model);
      return row.success ? [{ id: row.data.id, name: row.data.name ?? row.data.id }] : [];
    });
    const { login, key } = keyOf(config.apiKey, credentials.get(providerId));
    const state: LocalProviderState = login
      ? 'needs-login'
      : !api.success || baseUrl === null || providerModels.length === 0
        ? 'unsupported'
        : key === null
          ? 'needs-key'
          : 'ready';
    out.push({
      provider: {
        source: 'pi',
        providerId,
        label: config.name ?? providerId,
        api: api.success ? api.data : null,
        baseUrl: baseUrl ?? '',
        authHeader: config.authHeader ?? false,
        models: providerModels,
        state,
      },
      key: state === 'ready' ? key : null,
    });
  }
  for (const [providerId, credential] of credentials) {
    if (configured.some(([id]) => id === providerId)) continue;
    out.push({
      provider: {
        source: 'pi',
        providerId,
        label: providerId,
        api: null,
        baseUrl: '',
        authHeader: false,
        models: [],
        state: credential.type === 'oauth' ? 'needs-login' : 'needs-key',
      },
      key: null,
    });
  }
  return out;
}

export function piProviders(models: unknown, auth: unknown): LocalProvider[] {
  return entries(models, auth).map((entry) => entry.provider);
}

export function piProviderImports(
  models: unknown,
  auth: unknown,
  providerIds: readonly string[],
): LocalProviderImport[] {
  return entries(models, auth).flatMap(({ provider, key }) =>
    key !== null && providerIds.includes(provider.providerId) ? [{ ...provider, apiKey: key }] : [],
  );
}
