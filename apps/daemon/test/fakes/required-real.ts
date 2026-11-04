import { afterAll } from 'vitest';

export function realTestSuite(options: { registerSummary?: boolean } = {}) {
  const requiredSkips: string[] = [];
  const assertComplete = () => {
    if (requiredSkips.length > 0) {
      throw new Error(`Required-real suite incomplete: ${requiredSkips.join(', ')}`);
    }
  };
  if (options.registerSummary !== false) afterAll(assertComplete);
  return {
    assertComplete,
    async run(
      context: { skip: (reason: string) => void },
      test: { name: string; credential: string | undefined; required: boolean },
      run: () => Promise<void>,
    ): Promise<void> {
      if (!test.credential?.trim()) {
        if (test.required) requiredSkips.push(test.name);
        context.skip(`Missing credential: ${test.name}`);
        return;
      }
      await run();
    },
  };
}
