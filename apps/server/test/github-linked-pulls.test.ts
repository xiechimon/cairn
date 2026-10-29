import { describe, expect, test } from 'vitest';
import {
  type FetchLike,
  GITHUB_ISSUE_TIMELINE_MAX_PAGES,
  GithubRateLimitedError,
  githubIssueClosingPulls,
  githubIssueTimeline,
} from '../src/lib/github.js';

const TOKEN = 'ghp_linked_pulls_test_token';
const OWNER = 'xiechimon';
const REPO = 'cairn';
const ISSUE = 1958;
const TIMELINE = `https://api.github.com/repos/${OWNER}/${REPO}/issues/${ISSUE}/timeline?per_page=100`;
const GRAPHQL = 'https://api.github.com/graphql';

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Awaited<ReturnType<FetchLike>> {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body ?? null)),
  };
}

function fakeFetch(
  handler: (
    call: RecordedCall,
  ) => Awaited<ReturnType<FetchLike>> | Promise<Awaited<ReturnType<FetchLike>>>,
): { fetchImpl: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    fetchImpl: async (input, init) => {
      const call: RecordedCall = {
        url: String(input),
        method: (init?.method ?? 'GET').toUpperCase(),
        headers: { ...(init?.headers ?? {}) },
        body: init?.body,
      };
      calls.push(call);
      return handler(call);
    },
  };
}

function crossReferenced(pr: {
  number: number;
  state: 'open' | 'closed';
  mergedAt: string | null;
  repo: string;
  isPull?: boolean;
}) {
  const issue: Record<string, unknown> = {
    number: pr.number,
    state: pr.state,
    repository: { full_name: pr.repo },
  };
  if (pr.isPull !== false) {
    issue.pull_request = { merged_at: pr.mergedAt };
  }
  return {
    event: 'cross-referenced',
    created_at: '2026-10-27T12:00:00Z',
    source: { type: 'issue', issue },
  };
}

function graphqlBody(nodes: unknown[], hasNextPage = false) {
  return {
    data: {
      repository: {
        issue: {
          closedByPullRequestsReferences: {
            pageInfo: { hasNextPage },
            nodes,
          },
        },
      },
    },
  };
}

function gqlNode(input: {
  number: number;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  merged: boolean;
  repo: string;
}) {
  return {
    number: input.number,
    state: input.state,
    merged: input.merged,
    repository: { nameWithOwner: input.repo },
  };
}

describe('githubIssueTimeline', () => {
  test('timeline: a cross-referenced event whose source.issue has pull_request yields that PR number with its state', async () => {
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse(200, [
        crossReferenced({
          number: 42,
          state: 'open',
          mergedAt: null,
          repo: `${OWNER}/${REPO}`,
        }),
      ]),
    );
    await expect(githubIssueTimeline(fetchImpl, TOKEN, OWNER, REPO, ISSUE)).resolves.toEqual({
      complete: true,
      pulls: [{ number: 42, state: 'open', merged: false, repo: `${OWNER}/${REPO}` }],
    });
  });

  test('timeline: a cross-referenced event from a plain issue is not a PR', async () => {
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse(200, [
        crossReferenced({
          number: 7,
          state: 'open',
          mergedAt: null,
          repo: `${OWNER}/${REPO}`,
          isPull: false,
        }),
      ]),
    );
    await expect(githubIssueTimeline(fetchImpl, TOKEN, OWNER, REPO, ISSUE)).resolves.toEqual({
      complete: true,
      pulls: [],
    });
  });

  test('timeline: connected event yields the PR', async () => {
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse(200, [
        {
          event: 'connected',
          created_at: '2026-10-27T12:00:00Z',
          source: {
            type: 'issue',
            issue: {
              number: 99,
              state: 'closed',
              repository: { full_name: `${OWNER}/${REPO}` },
              pull_request: { merged_at: '2026-10-27T13:00:00Z' },
            },
          },
        },
      ]),
    );
    await expect(githubIssueTimeline(fetchImpl, TOKEN, OWNER, REPO, ISSUE)).resolves.toEqual({
      complete: true,
      pulls: [{ number: 99, state: 'closed', merged: true, repo: `${OWNER}/${REPO}` }],
    });
  });

  test('timeline: a PR from another repository is reported with its repo and never as same-repo', async () => {
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse(200, [
        crossReferenced({
          number: 3,
          state: 'open',
          mergedAt: null,
          repo: 'other/repo',
        }),
      ]),
    );
    const result = await githubIssueTimeline(fetchImpl, TOKEN, OWNER, REPO, ISSUE);
    expect(result).toEqual({
      complete: true,
      pulls: [{ number: 3, state: 'open', merged: false, repo: 'other/repo' }],
    });
    expect(result?.pulls[0]?.repo).not.toBe(`${OWNER}/${REPO}`);
  });

  test('timeline: rel=next on api.github.com is followed; rel=next on another host stops, returns complete:false, and the second request is never sent', async () => {
    const followed = fakeFetch((call) => {
      if (call.url === TIMELINE) {
        return jsonResponse(
          200,
          [
            crossReferenced({
              number: 1,
              state: 'open',
              mergedAt: null,
              repo: `${OWNER}/${REPO}`,
            }),
          ],
          {
            link: `<https://api.github.com/repos/${OWNER}/${REPO}/issues/${ISSUE}/timeline?per_page=100&page=2>; rel="next"`,
          },
        );
      }
      if (call.url.includes('page=2')) {
        return jsonResponse(200, [
          crossReferenced({
            number: 2,
            state: 'closed',
            mergedAt: null,
            repo: `${OWNER}/${REPO}`,
          }),
        ]);
      }
      return jsonResponse(500, { message: 'unexpected' });
    });
    await expect(
      githubIssueTimeline(followed.fetchImpl, TOKEN, OWNER, REPO, ISSUE),
    ).resolves.toEqual({
      complete: true,
      pulls: [
        { number: 1, state: 'open', merged: false, repo: `${OWNER}/${REPO}` },
        { number: 2, state: 'closed', merged: false, repo: `${OWNER}/${REPO}` },
      ],
    });
    expect(followed.calls).toHaveLength(2);

    const foreign = fakeFetch((call) => {
      if (call.url === TIMELINE) {
        return jsonResponse(
          200,
          [
            crossReferenced({
              number: 8,
              state: 'open',
              mergedAt: null,
              repo: `${OWNER}/${REPO}`,
            }),
          ],
          { link: `<https://evil.example/timeline?page=2>; rel="next"` },
        );
      }
      return jsonResponse(500, { message: 'must not follow foreign host' });
    });
    await expect(
      githubIssueTimeline(foreign.fetchImpl, TOKEN, OWNER, REPO, ISSUE),
    ).resolves.toEqual({
      complete: false,
      pulls: [{ number: 8, state: 'open', merged: false, repo: `${OWNER}/${REPO}` }],
    });
    expect(foreign.calls).toHaveLength(1);
    expect(foreign.calls.every((c) => !c.url.includes('evil.example'))).toBe(true);
    expect(foreign.calls.every((c) => !/evil\.example/i.test(JSON.stringify(c.headers)))).toBe(
      true,
    );
  });

  test('timeline: more pages than the page cap returns complete:false', async () => {
    const { fetchImpl, calls } = fakeFetch((call) => {
      const page = Number(new URL(call.url).searchParams.get('page') ?? '1');
      return jsonResponse(
        200,
        [
          crossReferenced({
            number: page,
            state: 'open',
            mergedAt: null,
            repo: `${OWNER}/${REPO}`,
          }),
        ],
        {
          link: `<https://api.github.com/repos/${OWNER}/${REPO}/issues/${ISSUE}/timeline?per_page=100&page=${page + 1}>; rel="next"`,
        },
      );
    });
    const result = await githubIssueTimeline(fetchImpl, TOKEN, OWNER, REPO, ISSUE);
    expect(result?.complete).toBe(false);
    expect(result?.pulls).toHaveLength(GITHUB_ISSUE_TIMELINE_MAX_PAGES);
    expect(calls).toHaveLength(GITHUB_ISSUE_TIMELINE_MAX_PAGES);
  });
});

describe('githubIssueClosingPulls', () => {
  test("graphql: state MERGED normalizes to {state:'closed', merged:true}", async () => {
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse(
        200,
        graphqlBody([
          gqlNode({ number: 10, state: 'MERGED', merged: true, repo: `${OWNER}/${REPO}` }),
        ]),
      ),
    );
    await expect(githubIssueClosingPulls(fetchImpl, TOKEN, OWNER, REPO, ISSUE)).resolves.toEqual({
      complete: true,
      pulls: [{ number: 10, state: 'closed', merged: true, repo: `${OWNER}/${REPO}` }],
    });
  });

  test('graphql: OPEN and CLOSED map to open/closed with merged:false', async () => {
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse(
        200,
        graphqlBody([
          gqlNode({ number: 1, state: 'OPEN', merged: false, repo: `${OWNER}/${REPO}` }),
          gqlNode({ number: 2, state: 'CLOSED', merged: false, repo: `${OWNER}/${REPO}` }),
        ]),
      ),
    );
    await expect(githubIssueClosingPulls(fetchImpl, TOKEN, OWNER, REPO, ISSUE)).resolves.toEqual({
      complete: true,
      pulls: [
        { number: 1, state: 'open', merged: false, repo: `${OWNER}/${REPO}` },
        { number: 2, state: 'closed', merged: false, repo: `${OWNER}/${REPO}` },
      ],
    });
  });

  test('graphql: pageInfo.hasNextPage true returns complete:false', async () => {
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse(
        200,
        graphqlBody(
          [gqlNode({ number: 3, state: 'OPEN', merged: false, repo: `${OWNER}/${REPO}` })],
          true,
        ),
      ),
    );
    await expect(githubIssueClosingPulls(fetchImpl, TOKEN, OWNER, REPO, ISSUE)).resolves.toEqual({
      complete: false,
      pulls: [{ number: 3, state: 'open', merged: false, repo: `${OWNER}/${REPO}` }],
    });
  });

  test('graphql: errors array returns unreadable', async () => {
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse(200, { errors: [{ message: 'Something went wrong' }] }),
    );
    await expect(githubIssueClosingPulls(fetchImpl, TOKEN, OWNER, REPO, ISSUE)).resolves.toBeNull();
  });

  test('graphql: missing data.repository.issue returns unreadable', async () => {
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse(200, { data: { repository: { issue: null } } }),
    );
    await expect(githubIssueClosingPulls(fetchImpl, TOKEN, OWNER, REPO, ISSUE)).resolves.toBeNull();
  });

  test('graphql: non-object body returns unreadable', async () => {
    const { fetchImpl } = fakeFetch(() => jsonResponse(200, 'not-json-object'));
    await expect(githubIssueClosingPulls(fetchImpl, TOKEN, OWNER, REPO, ISSUE)).resolves.toBeNull();
  });
});

describe('linked pull rate limits', () => {
  test('rate limit: REST 403 with x-ratelimit-remaining 0 and REST 429 throw GithubRateLimitedError', async () => {
    const forbidden = fakeFetch(() =>
      jsonResponse(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0' }),
    );
    await expect(
      githubIssueTimeline(forbidden.fetchImpl, TOKEN, OWNER, REPO, ISSUE),
    ).rejects.toBeInstanceOf(GithubRateLimitedError);

    const tooMany = fakeFetch(() =>
      jsonResponse(429, { message: 'You have exceeded a secondary rate limit' }),
    );
    await expect(
      githubIssueTimeline(tooMany.fetchImpl, TOKEN, OWNER, REPO, ISSUE),
    ).rejects.toBeInstanceOf(GithubRateLimitedError);

    await expect(
      githubIssueTimeline(forbidden.fetchImpl, TOKEN, OWNER, REPO, ISSUE).catch((e) => e),
    ).resolves.not.toEqual({ complete: true, pulls: [] });
  });

  test('graphql: 200 with errors[].type RATE_LIMITED throws GithubRateLimitedError', async () => {
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse(200, {
        errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }],
      }),
    );
    await expect(
      githubIssueClosingPulls(fetchImpl, TOKEN, OWNER, REPO, ISSUE),
    ).rejects.toBeInstanceOf(GithubRateLimitedError);
    await expect(
      githubIssueClosingPulls(fetchImpl, TOKEN, OWNER, REPO, ISSUE).catch((e) => e),
    ).resolves.not.toEqual({ complete: true, pulls: [] });
  });
});

test('acceptance command surface: timeline URL and GraphQL endpoint are requested', async () => {
  const { fetchImpl, calls } = fakeFetch((call) => {
    if (call.url.startsWith(TIMELINE.split('?')[0]!)) return jsonResponse(200, []);
    if (call.url === GRAPHQL) return jsonResponse(200, graphqlBody([]));
    return jsonResponse(404, { message: 'nope' });
  });
  await githubIssueTimeline(fetchImpl, TOKEN, OWNER, REPO, ISSUE);
  await githubIssueClosingPulls(fetchImpl, TOKEN, OWNER, REPO, ISSUE);
  expect(calls[0]?.url).toBe(TIMELINE);
  expect(calls[1]?.url).toBe(GRAPHQL);
  expect(calls[1]?.method).toBe('POST');
  expect(calls[1]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
});
