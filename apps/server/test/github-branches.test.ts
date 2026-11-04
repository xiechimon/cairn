import { expect, test } from 'vitest';
import { githubBranches } from '../src/lib/github-branches.js';

test('branch listing stops after ten full pages', async () => {
  let pages = 0;
  const result = await githubBranches(
    async (url) => {
      const listing = String(url).includes('/branches?');
      if (listing) pages += 1;
      const body =
        listing && pages <= 11
          ? Array.from({ length: 100 }, (_, index) => ({ name: `branch-${pages}-${index}` }))
          : listing
            ? []
            : { default_branch: 'main' };
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    },
    null,
    { owner: 'o', repo: 'r' },
  );
  expect(pages).toBe(10);
  expect(result.branches).toHaveLength(1000);
});
