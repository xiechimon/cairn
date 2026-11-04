import { expect, test } from 'vitest';
import { realTestSuite } from './fakes/required-real.js';

test('missing credentials skip explicitly and fail the required-real summary', async () => {
  const suite = realTestSuite({ registerSummary: false });
  const skipped: string[] = [];
  const ran: string[] = [];
  await suite.run(
    {
      skip: (reason: string) => {
        skipped.push(reason);
      },
    },
    { name: 'Claude smoke', credential: undefined, required: true },
    async () => {
      ran.push('ran');
    },
  );
  expect(skipped).toEqual(['Missing credential: Claude smoke']);
  expect(ran).toEqual([]);
  expect(() => suite.assertComplete()).toThrow(/incomplete.*Claude smoke/);
});

test('optional missing credentials skip without failing the summary', async () => {
  const suite = realTestSuite({ registerSummary: false });
  await suite.run(
    { skip: () => {} },
    { name: 'optional', credential: '', required: false },
    async () => {
      throw new Error('must skip');
    },
  );
  expect(() => suite.assertComplete()).not.toThrow();
});

test('credentialed tests execute and propagate failures', async () => {
  const suite = realTestSuite({ registerSummary: false });
  await expect(
    suite.run(
      { skip: () => {} },
      { name: 'Claude smoke', credential: 'present', required: true },
      async () => {
        throw new Error('provider failed');
      },
    ),
  ).rejects.toThrow('provider failed');
  expect(() => suite.assertComplete()).not.toThrow();
});
