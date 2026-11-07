import {
  CAIRN_REVIEW_HOLD_LABEL,
  isReviewBotAuthor,
  type PrReviewFinding,
  reviewFindingBadge,
} from '@cairn/shared';
import { z } from 'zod';
import { type FetchLike, GithubRateLimitedError, githubGraphql } from './github.js';
import { githubApiBaseUrl } from './github-api-base.js';

const pageInfo = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() });
const pullSchema = z.object({
  id: z.string().min(1),
  state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
  isDraft: z.boolean(),
  headRefOid: z.string().min(1),
  labels: z.object({
    nodes: z.array(z.object({ name: z.string() })),
    pageInfo: z.object({ hasNextPage: z.literal(false) }),
  }),
  timelineItems: z.object({
    nodes: z
      .array(
        z.discriminatedUnion('__typename', [
          z.object({
            __typename: z.literal('PullRequestCommit'),
            commit: z.object({ oid: z.string().min(1) }),
          }),
          z.object({
            __typename: z.literal('HeadRefForcePushedEvent'),
            afterCommit: z.object({ oid: z.string().min(1) }),
          }),
          z.object({
            __typename: z.literal('UnlabeledEvent'),
            label: z.object({ name: z.string() }),
          }),
        ]),
      )
      .max(50),
  }),
  reviewThreads: z.object({
    pageInfo,
    nodes: z.array(
      z.object({
        id: z.string().min(1),
        isResolved: z.boolean(),
        path: z.string(),
        line: z.number().int().nullable(),
        comments: z.object({
          nodes: z.tuple([
            z.object({
              author: z.object({ __typename: z.string(), login: z.string() }).nullable(),
              body: z.string(),
              url: z.string(),
            }),
          ]),
        }),
      }),
    ),
  }),
});

const query = `query($owner:String!,$name:String!,$number:Int!,$after:String,$label:String!){repository(owner:$owner,name:$name){label(name:$label){id} pullRequest(number:$number){id state isDraft headRefOid timelineItems(itemTypes:[PULL_REQUEST_COMMIT,HEAD_REF_FORCE_PUSHED_EVENT,UNLABELED_EVENT],last:50){nodes{__typename ... on PullRequestCommit{commit{oid}} ... on HeadRefForcePushedEvent{afterCommit{oid}} ... on UnlabeledEvent{label{name}}}} labels(first:100){nodes{name} pageInfo{hasNextPage}} reviewThreads(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{id isResolved path line comments(first:1){nodes{author{__typename login} body url}}}}}}}`;

export async function githubPrReviewFindings(
  fetch: FetchLike,
  token: string,
  owner: string,
  repo: string,
  number: number,
) {
  const findings: PrReviewFinding[] = [];
  const cursors = new Set<string>();
  let after: string | null = null;
  let snapshot:
    | {
        id: string;
        state: string;
        isDraft: boolean;
        head: string;
        labels: string[];
        labelId: string | null;
        timeline: z.infer<typeof pullSchema>['timelineItems']['nodes'];
        overridden: boolean;
        cairnHolds: boolean;
      }
    | undefined;
  for (;;) {
    const data = z
      .object({
        repository: z.object({
          label: z.object({ id: z.string().min(1) }).nullable(),
          pullRequest: pullSchema,
        }),
      })
      .parse(
        await githubGraphql(fetch, token, query, {
          owner,
          name: repo,
          number,
          after,
          label: CAIRN_REVIEW_HOLD_LABEL,
        }),
      );
    const pull = data.repository.pullRequest;
    if (
      data.repository.label === null &&
      pull.labels.nodes.some((label) => label.name === CAIRN_REVIEW_HOLD_LABEL)
    )
      throw new Error('GitHub review hold label inconsistent');
    const timeline = pull.timelineItems.nodes;
    const headIndex = timeline.findLastIndex((event) =>
      event.__typename === 'PullRequestCommit'
        ? event.commit.oid === pull.headRefOid
        : event.__typename === 'HeadRefForcePushedEvent' &&
          event.afterCommit.oid === pull.headRefOid,
    );
    const overridden = timeline
      .slice(headIndex + 1)
      .some(
        (event) =>
          event.__typename === 'UnlabeledEvent' && event.label.name === CAIRN_REVIEW_HOLD_LABEL,
      );
    const current = {
      id: pull.id,
      state: pull.state,
      isDraft: pull.isDraft,
      head: pull.headRefOid,
      labels: pull.labels.nodes.map((label) => label.name),
      labelId: data.repository.label?.id ?? null,
      timeline,
      overridden,
      cairnHolds:
        pull.isDraft && pull.labels.nodes.some((label) => label.name === CAIRN_REVIEW_HOLD_LABEL),
    };
    if (snapshot && JSON.stringify(snapshot) !== JSON.stringify(current))
      throw new Error('GitHub PR changed during review pagination');
    snapshot = current;
    for (const thread of pull.reviewThreads.nodes) {
      const first = thread.comments.nodes[0];
      if (
        !thread.isResolved &&
        first.author &&
        isReviewBotAuthor(first.author.login, first.author.__typename)
      )
        findings.push({
          id: thread.id,
          path: thread.path,
          line: thread.line,
          badge: reviewFindingBadge(first.body),
          body: first.body,
          url: first.url,
        });
    }
    if (!pull.reviewThreads.pageInfo.hasNextPage) return { ...snapshot, findings };
    after = pull.reviewThreads.pageInfo.endCursor;
    if (!after || cursors.has(after))
      throw new Error('GitHub review threads pagination incomplete');
    cursors.add(after);
  }
}

export async function githubSetPullDraft(
  fetch: FetchLike,
  token: string,
  id: string,
  draft: boolean,
): Promise<void> {
  const mutation = draft ? 'convertPullRequestToDraft' : 'markPullRequestReadyForReview';
  const data = await githubGraphql(
    fetch,
    token,
    `mutation($pullRequestId:ID!){changed:${mutation}(input:{pullRequestId:$pullRequestId}){pullRequest{isDraft}}}`,
    { pullRequestId: id },
  );
  z.object({ changed: z.object({ pullRequest: z.object({ isDraft: z.literal(draft) }) }) }).parse(
    data,
  );
}

export async function githubSetReviewHoldLabel(
  fetch: FetchLike,
  token: string,
  id: string,
  labelId: string,
  add: boolean,
): Promise<void> {
  const mutation = add ? 'addLabelsToLabelable' : 'removeLabelsFromLabelable';
  const data = await githubGraphql(
    fetch,
    token,
    `mutation($id:ID!,$labelId:ID!){changed:${mutation}(input:{labelableId:$id,labelIds:[$labelId]}){labelable{id}}}`,
    { id, labelId },
  );
  z.object({ changed: z.object({ labelable: z.object({ id: z.literal(id) }) }) }).parse(data);
}

export async function githubCreateReviewHoldLabel(
  fetch: FetchLike,
  token: string,
  owner: string,
  repo: string,
): Promise<void> {
  const url = `${githubApiBaseUrl()}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/labels`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
    },
    body: JSON.stringify({ name: CAIRN_REVIEW_HOLD_LABEL, color: 'd4c5f9' }),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.ok) return;
  const body: unknown = await response.json().catch(() => null);
  if (
    response.status === 429 ||
    (response.status === 403 &&
      (response.headers.get('x-ratelimit-remaining') === '0' ||
        response.headers.get('retry-after') !== null ||
        /rate limit|abuse detection/i.test(JSON.stringify(body))))
  )
    throw new GithubRateLimitedError(
      url,
      response.status,
      /^\d+$/.test(response.headers.get('x-ratelimit-reset') ?? '')
        ? Number(response.headers.get('x-ratelimit-reset')) * 1000
        : null,
      /^\d+$/.test(response.headers.get('retry-after') ?? '')
        ? Number(response.headers.get('retry-after'))
        : null,
    );
  if (
    response.status === 422 &&
    z
      .object({ errors: z.array(z.object({ code: z.string() })) })
      .safeParse(body)
      .data?.errors.some((error) => error.code === 'already_exists')
  )
    return;
  throw new Error(`GitHub review hold label creation failed: ${response.status}`);
}
