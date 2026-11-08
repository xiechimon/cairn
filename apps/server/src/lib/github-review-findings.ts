import {
  CAIRN_REVIEW_HOLD_LABEL,
  isReviewBotAuthor,
  type PrReviewFinding,
  reviewFindingBadge,
} from '@cairn/shared';
import { z } from 'zod';
import {
  type FetchLike,
  GithubRateLimitedError,
  githubGraphql,
  githubGraphqlRead,
} from './github.js';
import { githubApiBaseUrl } from './github-api-base.js';
import { type AutonomousToken, githubAppBotLogin, githubTokenFetch } from './github-token.js';

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
  timelineItems: z
    .object({
      nodes: z.array(
        z.object({
          __typename: z.string(),
          actor: z
            .object({ login: z.string(), __typename: z.string().optional() })
            .nullable()
            .optional(),
          label: z.object({ name: z.string() }).optional(),
          createdAt: z.string().optional(),
          commit: z
            .object({
              oid: z.string(),
              committedDate: z.string().optional(),
              pushedDate: z.string().nullable().optional(),
            })
            .optional(),
          afterCommit: z.object({ oid: z.string() }).nullable().optional(),
        }),
      ),
      pageInfo: z.object({ hasPreviousPage: z.boolean() }).optional(),
    })
    .optional(),
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

const query = `query($owner:String!,$name:String!,$number:Int!,$after:String,$label:String!){repository(owner:$owner,name:$name){label(name:$label){id} pullRequest(number:$number){id state isDraft headRefOid timelineItems(last:100,itemTypes:[LABELED_EVENT,UNLABELED_EVENT,READY_FOR_REVIEW_EVENT,PULL_REQUEST_COMMIT,HEAD_REF_FORCE_PUSHED_EVENT]){pageInfo{hasPreviousPage} nodes{__typename ... on LabeledEvent{actor{login __typename} label{name} createdAt} ... on UnlabeledEvent{actor{login __typename} label{name} createdAt} ... on ReadyForReviewEvent{actor{login __typename} createdAt} ... on PullRequestCommit{commit{oid committedDate pushedDate}} ... on HeadRefForcePushedEvent{createdAt afterCommit{oid}}}} labels(first:100){nodes{name} pageInfo{hasNextPage}} reviewThreads(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{id isResolved path line comments(first:1){nodes{author{__typename login} body url}}}}}}}`;

function timelineActorLogin(
  actor: { login: string; __typename?: string } | null | undefined,
): string | null {
  if (!actor) return null;
  const login = actor.login.toLowerCase();
  return actor.__typename === 'Bot' && !login.endsWith('[bot]') ? `${login}[bot]` : login;
}

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
        cairnHolds: boolean;
        humanOverride: boolean;
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
        await githubGraphqlRead(fetch, token, query, {
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
    const bot = githubAppBotLogin(token);
    const events = pull.timelineItems?.nodes ?? [];
    const headIndex = events.findLastIndex(
      (event) =>
        event.commit?.oid === pull.headRefOid || event.afterCommit?.oid === pull.headRefOid,
    );
    const headEvent = events[headIndex];
    const headTime =
      headEvent?.createdAt ?? headEvent?.commit?.pushedDate ?? headEvent?.commit?.committedDate;
    const lastHold = events.findLastIndex(
      (event) =>
        event.__typename === 'LabeledEvent' && event.label?.name === CAIRN_REVIEW_HOLD_LABEL,
    );
    const attributedHold = bot !== null && timelineActorLogin(events[lastHold]?.actor) === bot;
    const humanOverride =
      attributedHold &&
      headIndex >= 0 &&
      headTime !== undefined &&
      events.some(
        (event, index) =>
          index > headIndex &&
          index > lastHold &&
          event.actor != null &&
          timelineActorLogin(event.actor) !== bot &&
          event.createdAt !== undefined &&
          Date.parse(event.createdAt) > Date.parse(headTime) &&
          (event.__typename === 'ReadyForReviewEvent' ||
            (event.__typename === 'UnlabeledEvent' &&
              event.label?.name === CAIRN_REVIEW_HOLD_LABEL)),
      );
    const current = {
      humanOverride,
      id: pull.id,
      state: pull.state,
      isDraft: pull.isDraft,
      head: pull.headRefOid,
      labels: pull.labels.nodes.map((label) => label.name),
      labelId: data.repository.label?.id ?? null,
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
  token: AutonomousToken,
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
  token: AutonomousToken,
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
  token: AutonomousToken,
  owner: string,
  repo: string,
): Promise<void> {
  const url = `${githubApiBaseUrl()}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/labels`;
  const response = await githubTokenFetch(fetch, token)(url, {
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
