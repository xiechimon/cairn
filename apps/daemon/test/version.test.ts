import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';
import { DAEMON_VERSION } from '../src/version.js';

const requireManifest = createRequire(import.meta.url);

describe('DAEMON_VERSION', () => {
  test('matches the manifest version (hardcoding forbidden again)', () => {
    const pkg = requireManifest('../package.json') as { version: string };
    expect(DAEMON_VERSION).toBe(pkg.version);
  });
});
