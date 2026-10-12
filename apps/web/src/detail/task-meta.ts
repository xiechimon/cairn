// taskMeta 投影（#1127 自 todo-detail-page 提取）：live 方案空态的任务元信息
// ——纯函数，页面侧的 useMemo 只是它的缓存壳。字段序与缺省律见
// task-meta-block.tsx；fixture 面恒 null（无来源/机器/模型数据源），空态
// 占位「暂无方案」字节不变。

import { conversationBranch, parseGithubIssueSourceRef } from '@pacman/shared';
import type { useBuild, useBuildUsage } from '../api/hooks.js';
import type { toDisplayTodo } from '../api/mappers.js';
import type { TaskMetaFields } from './task-meta-block.js';

export function buildTaskMeta(input: {
  live: boolean;
  wireTodo: Parameters<typeof toDisplayTodo>[0] | null;
  buildId: string | null;
  build: ReturnType<typeof useBuild>['data'];
  machineField: string | null;
  machineWaiting: boolean;
  agentModel: string | null;
  usage: ReturnType<typeof useBuildUsage>['data'];
  /** ADR 0006 D5：来源 issue 标题的真值在 issue 侧（echo 查询）；拉不到
   *  退本地标题，行不因此丢失。 */
  sourceEchoTitle: string | undefined;
}): TaskMetaFields | null {
  const { live, wireTodo, buildId, build, machineField, machineWaiting, agentModel, usage } = input;
  if (!live || wireTodo == null || buildId == null) return null;
  const ref = wireTodo.sourceRef != null ? parseGithubIssueSourceRef(wireTodo.sourceRef) : null;
  const prUrl = build?.prUrl ?? null;
  const prNumber = build?.prNumber ?? null;
  return {
    sourceIssue:
      ref != null
        ? {
            number: ref.issueNumber,
            title: input.sourceEchoTitle ?? wireTodo.title,
            url: `https://github.com/${ref.owner}/${ref.repo}/issues/${ref.issueNumber}`,
          }
        : null,
    branch: conversationBranch(buildId),
    pr: prUrl != null && prNumber != null ? { number: prNumber, url: prUrl } : null,
    machine: machineField,
    machineWaiting,
    model: agentModel ?? usage?.[0]?.model ?? null,
    createdAt: wireTodo.buildHistory[0]?.createdAt ?? build?.createdAt ?? null,
  };
}
