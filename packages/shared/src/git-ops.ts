import type { WorkspaceHookNoteData } from './protocol/executor.js';
import type { LocalErrorReason, ProjectRepoKind } from './records/project.js';

export interface GitTreeEntry {
  name: string;
  path: string;
  type: 'blob' | 'tree';
  size: number | null;
}

export interface GitFileAtRef {
  size: number;
  content: Uint8Array;
}

export interface GitRefInfo {
  name: string;
  isDefault: boolean;
}

export interface GitCgiRequest {
  projectRoot: string;
  pathInfo: string;
  queryString: string;
  method: 'GET' | 'POST';
  contentType?: string;
  remoteUser?: string;
  body: Uint8Array;
}

export interface GitCgiResponse {
  status: number;
  headers: [string, string][];
  body: Uint8Array;
}

export interface GitOps {
  initBareRepo(dir: string): Promise<void>;
  seedInitialCommit(dir: string, message: string): Promise<string>;
  resolveCommit(dir: string, ref: string): Promise<string | null>;
  isGitRepo(dir: string): Promise<boolean>;
  lsTree(dir: string, commit: string, subPath?: string): Promise<GitTreeEntry[]>;
  readFileAt(dir: string, commit: string, path: string): Promise<GitFileAtRef | null>;
  listBranches(dir: string): Promise<{ defaultBranch: string | null; branches: GitRefInfo[] }>;
  isAncestor(dir: string, ancestor: string, commit: string): Promise<boolean>;
  updateBranchRef(dir: string, branch: string, commit: string): Promise<void>;
  httpBackend(req: GitCgiRequest): Promise<GitCgiResponse>;
}

export interface GitCredentials {
  username: string;
  password: string;
}

export interface BoundGitCredentials extends GitCredentials {
  url: string;
}

export type GitCredentialSource = 'integration' | 'machine';

export const GITHUB_ACCESS_TOKEN_USERNAME = 'x-access-token';

export interface CommitIdentity {
  name: string;
  email: string;
}

export interface WorktreePrepareInput {
  projectId: string;
  conversationId: string;
  cloneUrl: string;
  repoKind?: ProjectRepoKind;
  workspacesRoot: string;
  credentials: BoundGitCredentials | null;
  localPath?: string | null;
  machineCredentialFallback?: boolean;
  readonly?: boolean;
}

export interface PreparedWorkspace {
  cwd: string;
  baseRepoDir: string;
  branch: string;
  defaultBranch: string;
  reused: boolean;
  hooks?: WorkspaceHookNoteData[];
  credentialSource?: GitCredentialSource;
  readonly?: boolean;
}

export interface OrphanCleanupInput {
  workspacesRoot: string;
  ttlMs: number;
  now: number;
  activeConversationIds: Iterable<string>;
}

export interface WorktreeOps {
  prepare(input: WorktreePrepareInput): Promise<PreparedWorkspace>;
  commitAll(
    cwd: string,
    message: string,
    identity: CommitIdentity,
  ): Promise<{ committed: boolean; head: string | null }>;
  push(cwd: string, branch: string, credentials: BoundGitCredentials | null): Promise<void>;
  mergeDefaultBranch(cwd: string, defaultBranch: string): Promise<{ output: string }>;
  headCommit(cwd: string): Promise<string | null>;
  countAhead(cwd: string, defaultBranch: string): Promise<number>;
  currentBranch?(cwd: string): Promise<string | null>;
  branchesWithNewCommits?(cwd: string, baseCommit: string, sinceMs: number): Promise<string[]>;
  diffAgainstDefault?(cwd: string, defaultBranch: string): Promise<string>;
  restoreCheckpoint(cwd: string, commit: string): Promise<void>;
  cleanupOrphans(input: OrphanCleanupInput): Promise<string[]>;
  briefMarkerInRef?(cwd: string, ref: string): Promise<string[]>;
}

export const REMOTE_BRANCH_DIVERGED = 'remote branch diverged';

export class RemoteBranchDivergedError extends Error {
  constructor(branch: string) {
    super(`${REMOTE_BRANCH_DIVERGED}: ${branch}`);
    this.name = 'RemoteBranchDivergedError';
  }
}

export type LocalRepoUnreachableReason = Extract<LocalErrorReason, 'not_found' | 'not_git'>;

export class LocalRepoUnreachableError extends Error {
  constructor(
    readonly repoPath: string,
    readonly reason: LocalRepoUnreachableReason,
  ) {
    super(`local repo unreachable: ${repoPath} (${reason})`);
    this.name = 'LocalRepoUnreachableError';
  }
}

export const READONLY_EXPORT_MARKER = '.cairn-readonly-export';

export class ReadOnlyWorkspaceError extends Error {
  constructor(cwd: string) {
    super(`readonly workspace rejects git writes: ${cwd}`);
    this.name = 'ReadOnlyWorkspaceError';
  }
}
