import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePackagedJourneyArgs } from './packaged-journey.mjs';

test('parsePackagedJourneyArgs defaults to both server modes when --mode is omitted', () => {
  assert.deepEqual(parsePackagedJourneyArgs(['release/mac-arm64/Cairn.app'], '/work'), {
    appPath: 'release/mac-arm64/Cairn.app',
    evidenceRoot: '/work/release/packaged-journeys',
    modes: ['local-server', 'remote-server'],
  });
});

test('parsePackagedJourneyArgs accepts --mode as separate or equals flag', () => {
  assert.deepEqual(
    parsePackagedJourneyArgs(['/work/Cairn.app', '/work/out', '--mode', 'remote-server']),
    {
      appPath: '/work/Cairn.app',
      evidenceRoot: '/work/out',
      modes: ['remote-server'],
    },
  );
  assert.deepEqual(
    parsePackagedJourneyArgs(['--mode=local-server', '/work/Cairn.app', '/work/out']),
    {
      appPath: '/work/Cairn.app',
      evidenceRoot: '/work/out',
      modes: ['local-server'],
    },
  );
});

test('parsePackagedJourneyArgs rejects missing appPath or unknown mode', () => {
  assert.throws(() => parsePackagedJourneyArgs([]), /usage:/);
  assert.throws(() => parsePackagedJourneyArgs(['/work/Cairn.app', '--mode', 'bogus']), /unknown/);
  assert.throws(() => parsePackagedJourneyArgs(['/work/Cairn.app', '--unknown']), /unknown option/);
});
