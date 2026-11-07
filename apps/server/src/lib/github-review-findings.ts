import { isReviewBotAuthor, type PrReviewFinding, reviewFindingBadge } from '@cairn/shared';
import { z } from 'zod';
import { type FetchLike, githubGraphql } from './github.js';

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

const query = `query($owner:String!,$name:String!,$number:Int!,$after:String){repository(owner:$owner,name:$name){pullRequest(number:$number){id state isDraft headRefOid labels(first:100){nodes{name} pageInfo{hasNextPage}} reviewThreads(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{id isResolved path line comments(first:1){nodes{author{__typename login} body url}}}}}}}`;

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
    | { id: string; state: string; isDraft: boolean; head: string; labels: string[] }
    | undefined;
  for (;;) {
    const data = z
      .object({ repository: z.object({ pullRequest: pullSchema }) })
      .parse(await githubGraphql(fetch, token, query, { owner, name: repo, number, after }));
    const pull = data.repository.pullRequest;
    const current = {
      id: pull.id,
      state: pull.state,
      isDraft: pull.isDraft,
      head: pull.headRefOid,
      labels: pull.labels.nodes.map((label) => label.name),
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
  const read = await githubGraphql(
    fetch,
    token,
    'query($id:ID!){node(id:$id){... on PullRequest{isDraft}}}',
    { id },
  );
  z.object({ node: z.object({ isDraft: z.literal(draft) }) }).parse(read);
}
