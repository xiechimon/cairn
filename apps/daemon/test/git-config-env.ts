import { vi } from 'vitest';

export function stubOutInheritedGitConfig(): void {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('GIT_CONFIG_')) vi.stubEnv(k, undefined);
  }
}
