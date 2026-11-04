import { ENV_VARS } from '@cairn/shared';
import { describe, expect, test, vi } from 'vitest';
import {
  insecureBindWarning,
  loadConfig,
  missingRequiredTokenError,
  tailscaleBindWarning,
  tokenAuthStartupLines,
} from '../src/config.js';
import { startupMessage } from '../src/startup-log.js';

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;

describe('startup log (#1998)', () => {
  test('the online line names the api-keys route and the daemon start command', () => {
    const message = startupMessage();
    expect(message).toContain('POST /api/teams/{id}/api-keys');
    expect(message).toContain('start --api-key <key> --team <teamId>');
  });

  test('every startup log line is English-only', () => {
    const lines = [
      startupMessage(),
      ...tokenAuthStartupLines(loadConfig({ authToken: 'token', requireToken: true })),
      ...tokenAuthStartupLines(loadConfig({ authToken: 'token', host: '0.0.0.0' })),
      insecureBindWarning(loadConfig({ host: '0.0.0.0', authToken: null })),
      tailscaleBindWarning(loadConfig({ tailscaleUsers: ['someone@example.com'] })),
      missingRequiredTokenError(loadConfig({ requireToken: true, authToken: null })),
    ];
    const written = lines.filter((line): line is string => line !== null);
    expect(written, 'a startup message builder returned null').toHaveLength(lines.length);
    for (const line of written) expect(line, line).not.toMatch(CJK);
  });

  test('a half-configured oauth client fails in English', () => {
    vi.stubEnv(ENV_VARS.githubOauthClientId, 'client-id');
    let thrown: unknown;
    try {
      loadConfig();
    } catch (error) {
      thrown = error;
    }
    vi.unstubAllEnvs();
    expect(String(thrown)).toContain(ENV_VARS.githubOauthClientId);
    expect(String(thrown)).toContain(ENV_VARS.githubOauthClientSecret);
    expect(String(thrown)).not.toMatch(CJK);
  });
});
