import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MachineCapabilities } from '@cairn/shared';
import { z } from 'zod';

const codexCredentialSchema = z.object({
  type: z.literal('oauth'),
  access: z.string().min(1),
  refresh: z.string().min(1),
  expires: z.number().int().nonnegative(),
});

export function readCodexLogin(
  agentDir: string,
  now = Date.now(),
): NonNullable<MachineCapabilities['codexLogin']> {
  try {
    const data: unknown = JSON.parse(readFileSync(join(agentDir, 'auth.json'), 'utf8'));
    const auth = z.record(z.string(), z.unknown()).safeParse(data);
    if (!auth.success) return { state: 'unknown' };
    const value = auth.data['openai-codex'];
    if (value === undefined) return { state: 'absent' };
    if (
      typeof value === 'object' &&
      value !== null &&
      'type' in value &&
      value.type === 'api_key'
    ) {
      return { state: 'absent' };
    }
    const credential = codexCredentialSchema.safeParse(value);
    if (!credential.success) return { state: 'unknown' };
    const expiresAt = credential.data.expires;
    return { state: expiresAt <= now ? 'expired' : 'ok', expiresAt };
  } catch (error) {
    return { state: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'absent' : 'unknown' };
  }
}
