// create_tag 本地工具（XMON-111 T1）：agent 在其 worktree 打 annotated tag 并
// 推送 refs/tags 到 origin。凭证纪律（02 §5.4/§8）：git 凭证只活在 daemon
// 原语（gitCredentialEnv env 注入，不进 argv、不落盘），agent 的 bash 工具
// 拿不到——本工具是 tag 出机器的唯一通路。
// 权限纪律：注册条件 = claim `localTools` 含 create_tag（server 判定单源
// claimLocalTools，XMON-108 R1）；daemon 不自判权限，词缺席 = 工具不注册
// （fail-closed，agent 工具面不见该词）。
// 发布流不挂接（leader 裁定）：pacman 无发布管线；tag 推 origin 后用户仓
// 自身 CI 自然生效。

import type { BoundGitCredentials, CommitIdentity, LocalToolDef } from '@pacman/shared';
import { gitPrim } from './git.js';

/** 本地工具名（词值单源 = protocol/machine-wire.ts LOCAL_TOOL_CREATE_TAG）。 */
export const CREATE_TAG_TOOL_NAME = 'create_tag';

export interface CreateTagToolOpts {
  /** agent worktree 检出目录；null = 步未绑 repo（注册面照旧，execute 给
   * 明确原因——secret-channel 同律）。 */
  repoDir: string | null;
  /** per-step git 凭证（local 形态 = null，file 远端无需凭证）。 */
  cred: BoundGitCredentials | null;
  /** tagger 身份（必传）：annotated tag 没有 git 可用的兜底身份，无全局
   * user.name/user.email 的机器上 `git tag -a` 挂 128。调用方传本步的提交
   * 身份，标签署名与步内提交同源。 */
  identity: CommitIdentity;
}

/** create_tag 工具定义（LocalToolDef，daemon 进程内执行，不经 relay）。
 * 执行失败一律返回 git 原错误文本（tag 已存在 / 名字非法 / 推送被拒 /
 * 凭证失效）——agent 拿到的是 git 自己的拒绝原文，不是二次包装。 */
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
      // 推送单发不重试：tag 名冲突/凭证失效等拒绝是确定性的，git 原文直达
      // agent 即可自决（改名/换 commit 重打）；网络抖动重试留给收尾 push 面。
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
