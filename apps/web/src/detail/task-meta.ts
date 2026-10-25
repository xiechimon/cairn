import { conversationBranch, parseGithubIssueSourceRef } from '@cairn/shared';
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
