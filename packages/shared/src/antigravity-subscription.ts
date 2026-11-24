import { z } from 'zod';
import { subscriptionCheckSchema } from './subscription-check.js';

export const ANTIGRAVITY_TOKEN_REGEX = /^[A-Za-z0-9._~$+/=-]{16,4096}$/;
const OAUTH_ACCESS_TOKEN_REGEX = /^ya29\.[A-Za-z0-9._~-]{12,4091}$/;
export const ANTIGRAVITY_REFRESH_TOKEN_REGEX = /^1\/\/[A-Za-z0-9._~+/-]{16,4096}$/;

export function isAntigravityOAuthAccessToken(token: string): boolean {
  return OAUTH_ACCESS_TOKEN_REGEX.test(token);
}

export const antigravityOAuthAuthMethodSchema = z.enum(['consumer', 'business']);
export type AntigravityOAuthAuthMethod = z.infer<typeof antigravityOAuthAuthMethodSchema>;

export const antigravityOAuthSchema = z.strictObject({
  refreshToken: z
    .string()
    .trim()
    .regex(ANTIGRAVITY_REFRESH_TOKEN_REGEX, 'Invalid Antigravity OAuth refresh token'),
  authMethod: antigravityOAuthAuthMethodSchema.default('consumer'),
});
export type AntigravityOAuth = z.infer<typeof antigravityOAuthSchema>;

export const antigravityOAuthStepCredentialSchema = z
  .object({
    kind: z.literal('oauth-personal'),
    token: z.string().regex(OAUTH_ACCESS_TOKEN_REGEX).optional(),
    expiresAt: z.number().int().positive().max(8_640_000_000_000_000).optional(),
    refreshToken: z.string().regex(ANTIGRAVITY_REFRESH_TOKEN_REGEX).optional(),
    authMethod: antigravityOAuthAuthMethodSchema.optional(),
  })
  .refine(
    (value) =>
      (value.token !== undefined && value.expiresAt !== undefined) ||
      value.refreshToken !== undefined,
    {
      message: 'Antigravity OAuth credential requires a refresh token or a valid access token',
    },
  );
export type AntigravityOAuthStepCredential = z.infer<typeof antigravityOAuthStepCredentialSchema>;

export const ANTIGRAVITY_MODEL_NAME_MAX_LENGTH = 256;

export const antigravitySubscriptionModelSchema = z.strictObject({
  id: z.string().min(1).max(256),
  name: z.string().min(1).max(ANTIGRAVITY_MODEL_NAME_MAX_LENGTH),
});

export type AntigravitySubscriptionModel = z.infer<typeof antigravitySubscriptionModelSchema>;

export const ANTIGRAVITY_MODEL_GROUP_MAX_LENGTH = 64;

export const antigravityProbedModelSchema = antigravitySubscriptionModelSchema.extend({
  group: z.string().min(1).max(ANTIGRAVITY_MODEL_GROUP_MAX_LENGTH).optional(),
});

export type AntigravityProbedModel = z.infer<typeof antigravityProbedModelSchema>;

export const antigravitySubscriptionSchema = z.object({
  id: z.string(),
  kind: z.literal('antigravity-subscription'),
  label: z.string(),
  hasToken: z.boolean(),
  oauthPersonal: z.literal(true).optional(),
  runnerId: z.string().nullable().optional(),
  expiresAt: z.number().int().nullable(),
  enabled: z.boolean().optional(),
  enabledAt: z.number().int().nullable().optional(),
  models: z.array(antigravitySubscriptionModelSchema).optional(),
  createdAt: z.number().int(),
});

export type AntigravitySubscription = z.infer<typeof antigravitySubscriptionSchema>;

export const createAntigravitySubscriptionSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    token: z
      .string()
      .trim()
      .regex(ANTIGRAVITY_TOKEN_REGEX, 'Invalid credential format')
      .nullable()
      .optional(),
    expiresAt: z.number().int().positive().nullable().optional(),
    runnerId: z.string().min(1).max(256).optional(),
    refreshToken: z
      .string()
      .trim()
      .regex(ANTIGRAVITY_REFRESH_TOKEN_REGEX, 'Invalid Antigravity OAuth refresh token')
      .optional(),
    authMethod: antigravityOAuthAuthMethodSchema.optional(),
  })
  .refine(
    (body) =>
      body.refreshToken === undefined ||
      body.token == null ||
      isAntigravityOAuthAccessToken(body.token),
    { message: 'Cannot combine a Gemini API key with a Google OAuth refresh token' },
  );

export type CreateAntigravitySubscription = z.infer<typeof createAntigravitySubscriptionSchema>;

export const renameAntigravitySubscriptionSchema = z
  .object({
    label: z.string().trim().min(1).max(100).optional(),
    models: z.array(antigravitySubscriptionModelSchema).max(2000).optional(),
    runnerId: z.string().min(1).max(256).optional(),
  })
  .refine(
    (body) => body.label !== undefined || body.models !== undefined || body.runnerId !== undefined,
    { message: 'Nothing to update' },
  );

export type PatchAntigravitySubscription = z.infer<typeof renameAntigravitySubscriptionSchema>;

export const antigravitySubscriptionVerifyResultSchema = z.object({
  ok: z.boolean(),
  reason: z.enum(['auth', 'timeout', 'unavailable', 'failed', 'missing_local_login']).optional(),
  runnerName: z.string().nullable().optional(),
  check: subscriptionCheckSchema.optional(),
});

export type AntigravitySubscriptionVerifyResult = z.infer<
  typeof antigravitySubscriptionVerifyResultSchema
>;
