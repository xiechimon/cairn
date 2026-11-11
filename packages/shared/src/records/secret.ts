import { z } from 'zod';
import { recordId } from './common.js';

export const secretRecordSchema = z.object({
  id: recordId,
  teamId: recordId,
  projectId: recordId.nullable(),
  name: z.string(),
  description: z.string().nullable(),
});
export type SecretRecord = z.infer<typeof secretRecordSchema>;

export const setSecretBodySchema = z.object({
  name: z.string(),
  description: z.string().nullish(),
  value: z.string(),
  projectId: recordId.nullish(),
});
export type SetSecretBody = z.infer<typeof setSecretBodySchema>;

export const SECRET_MIN_CLI_VERSION = '0.1.28';
