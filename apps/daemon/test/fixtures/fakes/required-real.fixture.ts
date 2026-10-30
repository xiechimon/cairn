import { test } from 'vitest';
import { realTestSuite } from '../../fakes/required-real.js';

const suite = realTestSuite();
test('real Claude smoke', async (context) => {
  await suite.run(
    context,
    { name: 'real Claude smoke', credential: undefined, required: true },
    async () => {
      throw new Error('Missing credentials must never execute');
    },
  );
});
