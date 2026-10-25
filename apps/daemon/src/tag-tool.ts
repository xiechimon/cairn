import type { BoundGitCredentials, CommitIdentity, LocalToolDef } from '@cairn/shared';
import { gitPrim } from './git.js';

export const CREATE_TAG_TOOL_NAME = 'create_tag';

export interface CreateTagToolOpts {
  repoDir: string | null;
  cred: BoundGitCredentials | null;
  identity: CommitIdentity;
}

export function buildCreateTagTool(opts: CreateTagToolOpts): LocalToolDef {
  return {
    name: CREATE_TAG_TOOL_NAME,
    label: CREATE_TAG_TOOL_NAME,
    description:
      'Create an annotated git tag in your repository worktree and push it to origin ' +
      '(refs/tags/<tag>). Git credentials are held by the daemon and never reach your ' +
      'shell — pushing a tag from bash is not possible; this tool is the only way. ' +
      'Pushing a tag may trigger release workflows configured in the repository itself.',
    parameters: {
      type: 'object',
      properties: {
        tag: {
          type: 'string',
          description: 'Tag name, e.g. v1.2.0 (must be a name git accepts).',
        },
        message: {
          type: 'string',
          description: 'Annotation message; defaults to the tag name.',
        },
        commit: {
          type: 'string',
          description: 'Commit-ish to tag (sha, branch, ...); defaults to HEAD.',
        },
      },
      required: ['tag'],
    },
    execute: async (params: Record<string, unknown>): Promise<string> => {
      const tag = typeof params.tag === 'string' ? params.tag.trim() : '';
      if (tag === '') return 'create_tag needs a non-empty "tag".';
      if (opts.repoDir === null) {
        return 'create_tag is unavailable: this step has no repository worktree (the project is not bound to a repo).';
      }
      const message =
        typeof params.message === 'string' && params.message.trim() !== '' ? params.message : tag;
      const commit =
        typeof params.commit === 'string' && params.commit.trim() !== ''
          ? params.commit.trim()
          : null;
      try {
        await gitPrim.tagCreate(opts.repoDir, tag, message, commit, opts.identity);
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
      try {
        await gitPrim.tagPush(opts.repoDir, tag, opts.cred);
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        return `${text} (tag "${tag}" was created locally but NOT pushed to origin)`;
      }
      return `annotated tag "${tag}" created and pushed to origin (refs/tags/${tag})`;
    },
  };
}
