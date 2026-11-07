import { describe, expect, test } from 'vitest';
import { createServerLogger } from '../src/lib/logger.js';

describe('server logging boundary', () => {
  test.each(['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const)(
    '%s redacts serialized errors, headers, URL fragments and raw access tokens',
    (level) => {
      const token = 'synthetic-server-access-token';
      const lines: string[] = [];
      const logger = createServerLogger(
        [token],
        { level: 'trace' },
        { write: (line) => lines.push(line) },
      );
      logger[level](
        {
          err: new Error(`request failed http://localhost/app#token=${token}`),
          headers: { authorization: 'Basic dXNlcjpwYXNz' },
          token,
        },
        `request for ${token}`,
      );
      expect(lines.length).toBe(1);
      expect(
        lines.some(
          (line) =>
            line.includes(token) || line.includes('#token=') || line.includes('dXNlcjpwYXNz'),
        ),
      ).toBe(false);
      expect(lines[0]).toContain('[REDACTED]');
      expect(JSON.parse(lines[0] ?? '{}').err.message).toContain('request failed');
    },
  );
});
