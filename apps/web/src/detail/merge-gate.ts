import type { AgentRecord } from '@cairn/shared';
import { useMemo } from 'react';
import { ApiError } from '../api/client.js';
import { useMembers } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import type { TFunc } from '../i18n/translate.js';

export const MERGE_GATE_TOOLS = ['合并分支', '推送分支'] as const;

export function missingMergeTools(tools: readonly string[] | null | undefined): string[] {
  if (tools == null) return [];
  return MERGE_GATE_TOOLS.filter((tool) => !tools.includes(tool));
}

export function mergeRejectCopy(error: unknown, t: TFunc, fallback?: string): string {
  return error instanceof ApiError && error.status < 500 && error.message !== ''
    ? error.message
    : (fallback ?? t('合并请求未送出，请重试。'));
}

export function useMergeGate(agentId: string | null, fixtureAgents?: AgentRecord[]): string[] {
  const { live, teamId } = useLiveData();
  const membersQ = useMembers(teamId, live);
  return useMemo(() => {
    if (agentId == null) return [];
    if (!live) return missingMergeTools(fixtureAgents?.find((a) => a.id === agentId)?.tools);
    const member = (membersQ.data ?? []).find(
      (m) => m.memberType === 'agent' && m.actorId === agentId,
    );
    return missingMergeTools((member?.actor as { tools?: string[] } | undefined)?.tools);
  }, [live, agentId, membersQ.data, fixtureAgents]);
}
