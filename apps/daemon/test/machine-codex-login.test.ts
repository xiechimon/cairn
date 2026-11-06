import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { boot, waitFor } from './machine-loop-harness.js';

test('enrollment and presence report only Codex login metadata and follow logout', async () => {
  const expiresAt = Date.now() + 60_000;
  let authPath = '';
  const { handle, api } = await boot({
    presenceIntervalMs: 40,
    seedJournal: (paths) => {
      mkdirSync(paths.agentRuntimeDir, { recursive: true });
      authPath = join(paths.agentRuntimeDir, 'auth.json');
      writeFileSync(
        authPath,
        JSON.stringify({
          'openai-codex': {
            type: 'oauth',
            access: 'secret-access',
            refresh: 'secret-refresh',
            expires: expiresAt,
            accountId: 'private-account',
          },
        }),
      );
    },
  });
  try {
    await waitFor(() => api.presenceBodies.length > 0);
    for (const body of [api.enrollBodies[0], api.presenceBodies[0]]) {
      expect(body).toMatchObject({ capabilities: { codexLogin: { state: 'ok', expiresAt } } });
      expect((body as { capabilities: { codexLogin: unknown } }).capabilities.codexLogin).toEqual({
        state: 'ok',
        expiresAt,
      });
      expect(JSON.stringify(body)).not.toMatch(
        /secret-access|secret-refresh|private-account|accountId|"access"|"refresh"/,
      );
    }
    writeFileSync(authPath, '{}');
    await waitFor(() =>
      api.presenceBodies.some(
        (body) =>
          (body as { capabilities?: { codexLogin?: { state: string } } }).capabilities?.codexLogin
            ?.state === 'absent',
      ),
    );
  } finally {
    await handle.stop();
    await handle.done;
  }
});
