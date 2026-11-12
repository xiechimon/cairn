import { z } from 'zod';
import { isMailSecretName } from '../mail.js';
import { WEB_BRAVE_KEY_SECRET, WEB_EXA_KEY_SECRET } from '../web-search.js';
import { recordId } from './common.js';

export const SECRET_DELIVERIES = ['plaintext', 'http'] as const;
export const secretDeliverySchema = z.enum(SECRET_DELIVERIES);
export type SecretDelivery = z.infer<typeof secretDeliverySchema>;

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

export function isDaemonReadSecretName(name: string): boolean {
  return name === WEB_EXA_KEY_SECRET || name === WEB_BRAVE_KEY_SECRET || isMailSecretName(name);
}

export const secretHttpPolicySchema = z.strictObject({
  origin: z.string().transform((value, ctx) => {
    const origin = normalizeSecretOrigin(value);
    if (origin !== null) return origin;
    ctx.addIssue({ code: 'custom', message: 'origin must be https://host on port 443' });
    return z.NEVER;
  }),
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
});
export type SecretRecord = z.infer<typeof secretRecordSchema>;

export const setSecretBodySchema = z.object({
  name: z.string(),
  description: z.string().nullish(),
  value: z.string(),
  projectId: recordId.nullish(),
  delivery: secretDeliverySchema.optional(),
  http: secretHttpPolicySchema.optional(),
});
export type SetSecretBody = z.infer<typeof setSecretBodySchema>;

export const SECRET_MIN_CLI_VERSION = '0.1.28';
