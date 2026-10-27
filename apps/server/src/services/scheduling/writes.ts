import {
  type FetchLike,
  githubAddIssueLabel,
  githubCloseIssueWithComment,
  githubCommentIssue,
  githubIssueLiveState,
  githubRemoveIssueLabel,
} from '../../lib/github.js';
import type { BuildDeps } from '../builds.js';

export interface ScheduleIssueState {
  number: number;
  state: 'open' | 'closed';
  updatedAt: number;
}

export interface ScheduleGithubWriter {
  issue(
    token: string,
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<ScheduleIssueState | null>;
  addLabel(
    token: string,
    owner: string,
    repo: string,
    issueNumber: number,
    label: string,
  ): Promise<void>;
  removeLabel(
    token: string,
    owner: string,
    repo: string,
    issueNumber: number,
    label: string,
  ): Promise<void>;
  comment(
    token: string,
    owner: string,
    repo: string,
    issueNumber: number,
    body: string,
  ): Promise<void>;
  closeIssue(
    token: string,
    owner: string,
    repo: string,
    issueNumber: number,
    comment: string,
    stateReason: 'completed' | 'not_planned',
  ): Promise<void>;
}

export function scheduleGithubWriter(deps: Pick<BuildDeps, 'githubFetch'>): ScheduleGithubWriter {
  const fetchImpl = deps.githubFetch as FetchLike;
  return {
    issue: (token, owner, repo, issueNumber) =>
      githubIssueLiveState(fetchImpl, token, owner, repo, issueNumber),
    addLabel: (token, owner, repo, issueNumber, label) =>
      githubAddIssueLabel(fetchImpl, token, owner, repo, issueNumber, label),
    removeLabel: (token, owner, repo, issueNumber, label) =>
      githubRemoveIssueLabel(fetchImpl, token, owner, repo, issueNumber, label),
    comment: (token, owner, repo, issueNumber, body) =>
      githubCommentIssue(fetchImpl, token, owner, repo, issueNumber, body),
    closeIssue: (token, owner, repo, issueNumber, comment, stateReason) =>
      githubCloseIssueWithComment(fetchImpl, token, owner, repo, issueNumber, comment, stateReason),
  };
}
