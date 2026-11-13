import {
  type BoundGitCredentials,
  type CommitIdentity,
  type GitCredentialSource,
  LOCAL_TOOL_CREATE_TAG,
  type LocalToolDef,
} from '@cairn/shared';
import { withGitCredentialFallback } from './git.js';
import { buildCreateTagTool } from './tag-tool.js';

type GitOperation = (credential: BoundGitCredentials | null) => Promise<void>;

export type StepGitRunner = (operation: GitOperation) => Promise<GitCredentialSource>;

export function stepGitRunner(input: {
  credential: BoundGitCredentials | null;
  appCredential: { needsRefresh(): boolean } | null;
  refresh: () => Promise<BoundGitCredentials>;
  allowMachineFallback: boolean;
  log: (line: string) => void;
}): StepGitRunner {
  return async (operation) => {
    let refreshed = false;
    const refresh = async () => {
      if (refreshed) throw new Error('App credential authentication failed after refresh');
      refreshed = true;
      return input.refresh();
    };
    if (input.appCredential?.needsRefresh()) await input.refresh();
    return withGitCredentialFallback(operation, input.credential, {
      what: 'push',
      allowMachineFallback: input.allowMachineFallback,
      refresh,
      onFallback: (reason) =>
        input.log(
          `git push auth failed (per-step token), retrying with machine credentials: ${reason}`,
        ),
    });
  };
}

export function prepareCreateTagTool(input: {
  localTools: readonly string[] | undefined;
  repoDir: string | null;
  credential: BoundGitCredentials | null;
  identity: CommitIdentity;
  runGit: StepGitRunner;
  redact: (message: string) => string;
}): LocalToolDef | null {
  if (!(input.localTools ?? []).includes(LOCAL_TOOL_CREATE_TAG)) return null;
  return buildCreateTagTool({
    repoDir: input.repoDir,
    cred: input.credential,
    identity: input.identity,
    withCredentials: async (operation) => {
      try {
        await input.runGit(operation);
      } catch (error) {
        throw new Error(input.redact(error instanceof Error ? error.message : String(error)));
      }
    },
  });
}
