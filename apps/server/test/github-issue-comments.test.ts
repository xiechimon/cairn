import { expect, test } from 'vitest';
import { githubIssueComments } from '../src/lib/github.js';
import type { AutonomousToken } from '../src/lib/github-token.js';

const PER_PAGE = 100;
const FULL_PAGES = 11;

function commentPage(page: number) {
  if (page > FULL_PAGES) return [];
  return Array.from({ length: PER_PAGE }, (_, index) => ({
    body: `comment-${page}-${index}`,
    user: { login: `author-${page}` },
  }));
}

test('comment reads follow pagination past the tenth page to the last one', async () => {
  const requested: number[] = [];
  const comments = await githubIssueComments(
    async (input) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/repos/octo/alpha/issues/7/comments');
      const page = Number(url.searchParams.get('page') ?? '1');
      requested.push(page);
      const body = commentPage(page);
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    },
    'token' as AutonomousToken,
    'octo',
    'alpha',
    7,
  );
  expect(comments).not.toBeNull();
  expect(comments).toHaveLength(FULL_PAGES * PER_PAGE);
  expect(comments?.[0]).toEqual({ author: 'author-1', body: 'comment-1-0' });
  expect(comments?.at(-1)).toEqual({
    author: `author-${FULL_PAGES}`,
    body: `comment-${FULL_PAGES}-${PER_PAGE - 1}`,
  });
  expect(requested).toEqual(Array.from({ length: FULL_PAGES + 1 }, (_, index) => index + 1));
});
