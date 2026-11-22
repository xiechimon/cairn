import { z } from 'zod';
import { isMailSecretName } from '../mail.js';
import { WEB_BRAVE_KEY_SECRET, WEB_EXA_KEY_SECRET } from '../web-search.js';
import { recordId } from './common.js';

export const COMPOSIO_SECRET_PREFIX = 'composio.';

export function isComposioSecretName(name: string): boolean {
  const folded = name
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .trim()
    .toLowerCase();
  return folded.startsWith(COMPOSIO_SECRET_PREFIX);
}

export const SECRET_DELIVERIES = ['plaintext', 'http'] as const;
export const secretDeliverySchema = z.enum(SECRET_DELIVERIES);
export type SecretDelivery = z.infer<typeof secretDeliverySchema>;

export const SECRET_KINDS = ['secret', 'env', 'pair'] as const;
export const secretKindSchema = z.enum(SECRET_KINDS);
export type SecretKind = z.infer<typeof secretKindSchema>;

export const SECRET_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
export const SECRET_NAME_RULE =
  'name must use capital letters, digits and _, not starting with a digit';

export const SECRET_TEMPLATE_SLOT = '{secret}';

const HTTP_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const CONTROL_CHARACTER = /\p{Cc}/u;
const IPV4_LITERAL = /^\d+(\.\d+){3}$/;
const FORBIDDEN_SECRET_HEADERS: readonly string[] = [
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'upgrade',
  'te',
  'trailer',
  'expect',
];

export function normalizeSecretOrigin(input: string): string | null {
  if (input.includes('*') || !URL.canParse(input)) return null;
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null;
  if (url.port !== '' || url.hostname === '') return null;
  if (IPV4_LITERAL.test(url.hostname) || url.hostname.startsWith('[')) return null;
  const folded = input.toLowerCase();
  return folded === url.origin || folded === `${url.origin}:443` ? url.origin : null;
}

export function isBrowserLoopbackOrigin(origin: string): boolean {
  return ['127.0.0.1', '[::1]', 'localhost'].includes(new URL(origin).hostname);
}

export function normalizeBrowserSecretOrigin(input: string): string | null {
  if (input.includes('*') || !URL.canParse(input)) return null;
  const url = new URL(input);
  if (url.username !== '' || url.password !== '' || url.hostname === '') return null;
  const folded = input.toLowerCase();
  const defaultPort = url.protocol === 'https:' ? '443' : '80';
  if (folded !== url.origin && folded !== `${url.origin}:${defaultPort}`) return null;
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (isBrowserLoopbackOrigin(url.origin)) return url.origin;
  if (url.protocol !== 'https:' || IPV4_LITERAL.test(url.hostname)) return null;
  if (
    url.hostname.startsWith('[') ||
    url.hostname.endsWith('.localhost') ||
    url.hostname.endsWith('.')
  )
    return null;
  return url.origin;
}

export function isSecretHeaderName(name: string): boolean {
  const folded = name.toLowerCase();
  return (
    HTTP_TOKEN.test(name) &&
    !FORBIDDEN_SECRET_HEADERS.includes(folded) &&
    !folded.startsWith('proxy-')
  );
}

export function isSecretHeaderTemplate(template: string): boolean {
  return template.split(SECRET_TEMPLATE_SLOT).length === 2 && !CONTROL_CHARACTER.test(template);
}

export function isHttpSecretValue(value: string): boolean {
  return value !== '' && !CONTROL_CHARACTER.test(value);
}

const CREDENTIAL_NAME =
  /SECRET|TOKEN|PRIVATE|APIKEY|BEARER|MNEMONIC|TOTP|AUTHORIZATION|(^|_)(PASS|CRED|CERT|PEM|SEED|SESSION|OTP)|(^|_)(KEYS?|PATS?|AUTH|PINS?)(_|$)/;

export function isCredentialSecretName(name: string): boolean {
  return CREDENTIAL_NAME.test(name);
}

export function isDaemonReadSecretName(name: string): boolean {
  return (
    name === WEB_EXA_KEY_SECRET ||
    name === WEB_BRAVE_KEY_SECRET ||
    isMailSecretName(name) ||
    isComposioSecretName(name)
  );
}

export const secretHttpPolicySchema = z.strictObject({
  origin: z
    .string()
    .refine(
      (value) => normalizeSecretOrigin(value) !== null,
      'origin must be https://host on port 443',
    ),
  header: z.string().refine(isSecretHeaderName, 'header cannot carry a secret'),
  template: z
    .string()
    .refine(
      isSecretHeaderTemplate,
      'template needs exactly one {secret} slot and no control characters',
    ),
});
export type SecretHttpPolicy = z.infer<typeof secretHttpPolicySchema>;

export const secretRecordSchema = z.object({
  id: recordId,
  teamId: recordId,
  projectId: recordId.nullable(),
  name: z.string(),
  description: z.string().nullable(),
  delivery: secretDeliverySchema.optional(),
  http: secretHttpPolicySchema.nullish(),
  policyRevision: z.number().int().positive().optional(),
  kind: secretKindSchema.optional(),
  updatedAt: z.number().int().nullish(),
});
export type SecretRecord = z.infer<typeof secretRecordSchema>;

export const secretListEntrySchema = secretRecordSchema.extend({ value: z.string().optional() });
export type SecretListEntry = z.infer<typeof secretListEntrySchema>;

export const setSecretBodySchema = z.object({
  name: z.string().regex(SECRET_NAME_PATTERN, SECRET_NAME_RULE),
  description: z.string().nullish(),
  value: z.string(),
  kind: secretKindSchema.optional(),
  username: z.string().optional(),
  projectId: recordId.nullish(),
  delivery: secretDeliverySchema.optional(),
  http: secretHttpPolicySchema.optional(),
});
export type SetSecretBody = z.infer<typeof setSecretBodySchema>;

export const BROWSER_PASSWORD_GRANT_STATES = ['active', 'stale', 'revoked'] as const;
export const browserPasswordGrantSchema = z.object({
  grantId: recordId,
  secretId: recordId,
  secretName: z.string().nullable(),
  origin: z.string(),
  machineId: z.string(),
  machineName: z.string().nullable(),
  state: z.enum(BROWSER_PASSWORD_GRANT_STATES),
  createdAt: z.number().int(),
  grantedAt: z.number().int().nullable(),
  revokedAt: z.number().int().nullable(),
});
export type BrowserPasswordGrant = z.infer<typeof browserPasswordGrantSchema>;

export const browserPasswordGrantsResponseSchema = z.object({
  grants: z.array(browserPasswordGrantSchema),
});
export type BrowserPasswordGrantsResponse = z.infer<typeof browserPasswordGrantsResponseSchema>;

export const CLOAK_LICENSE_SECRET = 'CLOAKBROWSER_LICENSE_KEY';
export const SECRET_MIN_CLI_VERSION = '0.1.28';
