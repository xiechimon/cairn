import { z } from 'zod';
import { recordId } from './common.js';

export const secretRecordSchema = z.object({
  id: recordId,
  teamId: recordId,
  name: z.string(),
  description: z.string().nullable(),
});
export type SecretRecord = z.infer<typeof secretRecordSchema>;

export const setSecretBodySchema = z.object({
  name: z.string(),
  description: z.string().nullish(),
  value: z.string(),
});
export type SetSecretBody = z.infer<typeof setSecretBodySchema>;

export const SECRET_MIN_CLI_VERSION = '0.1.28';

export const SECRET_PAGE_COPY = {
  empty: '尚无密钥。',
  inject:
    '团队密钥按 Agent 授权，在需要它的执行步中下发，不预置进任务 shell 环境。值只写不读：保存后只能覆盖或删除，无法再次查看。',
  encryptedNotice: '值将加密存储，保存后无法再次查看。',
  chiefHint: '也可以让总管添加：它会开一张安全输入卡填写值，值不会进入对话。',
} as const;
