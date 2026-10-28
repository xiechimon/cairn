import { z } from 'zod';

export const feishuBotBodySchema = z.object({
  appId: z
    .string()
    .trim()
    .regex(/^cli_[A-Za-z0-9]+$/)
    .max(256),
  appSecret: z.string().trim().max(4096),
  openId: z
    .string()
    .trim()
    .regex(/^ou_[A-Za-z0-9]+$/)
    .max(256),
  cairnOrigin: z
    .string()
    .trim()
    .max(2048)
    .transform((value, ctx) => {
      try {
        const url = new URL(value);
        if (
          !['http:', 'https:'].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.pathname !== '/' ||
          url.search ||
          url.hash
        )
          throw new Error('invalid origin');
        return url.origin;
      } catch {
        ctx.addIssue({
          code: 'custom',
          message: 'Expected an HTTP(S) origin without credentials, path, query or fragment',
        });
        return z.NEVER;
      }
    }),
});

export type FeishuBotBody = z.infer<typeof feishuBotBodySchema>;

export interface FeishuBotStatus {
  configured: boolean;
  appId: string | null;
  openId: string | null;
  cairnOrigin: string | null;
}
