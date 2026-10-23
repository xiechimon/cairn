// 合并前置检查（XMON-89）：merge 弹层的「完成」是否该禁用、禁用时点名缺哪
// 几项，由本模块一个纯函数 + 一个读面钩子决定。两处入口（详情页 / 看板）共用
// 它——同一份判据只有一处实现，两处禁用态与文案因此不可能各说各的。
//
// 语义对齐 server 侧闸（XMON-26 实施②，services/builds.ts requestMerge）：闸读
// 的正是**将执行合并的那个 Agent** 的 tools —— merge 步走 build 槽
// （services/machines.ts agentForStep：`kind === 'plan' ? plan : build`）。所以
// 调用面传进来的是 assignment.build.agentId，不是「卡片上显示的那个 Agent」
// （显示投影是 build ?? plan 折算，两槽分设时两者会分叉）。
//
// 「不拦」只有一支：判据未知（无指派 / members 读面未到位）——server 侧闸对同
// 一情形也是放行的（无 Agent 可查 = 无闸可查），前端拦下就是纯误伤。
//
// 空授权集**不在此列**（#994）。`agent.tools` 列 `notNull().default('[]')` 曾
// 让「从未保存过权限 tab」与「显式全关」压成同一个值，2026-10-01 的 0018 回填
// （PR #576）已把存量行补成含「推送分支」（空集行 → `["推送分支"]`，逐形态断言
// 见 apps/server/test/agent-tool-backfill.test.ts）。此后库里剩下的 `[]` 只有
// 两条来路，且都是显式表达：权限 tab 逐个关到最后一档，或建号/改号 API 显式传
// `tools: []`（routes.ts create/patch：「显式携带（含 `[]` = 全关）照旧尊重」）。
// server 侧 requestMerge 对 `[]` 无豁免、一律拒（#994 隔离栈实测：同相位同端点、
// 唯 tools 为变量——两开关齐备 202 delegated / 空集 403），前端再按旧语义放行，
// 就是「点得动、点了必被拒」：禁用态与点名文案本就是现成的。

import type { AgentRecord } from '@cairn/shared';
import { useMemo } from 'react';
import { ApiError } from '../api/client.js';
import { useMembers } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import type { TFunc } from '../i18n/translate.js';

/** merge 步的两个前置开关（值域词同 shared AGENT_TOOL_SWITCHES；数组序 =
 *  报缺序，稳定序才有可比对的截图与断言）。 */
export const MERGE_GATE_TOOLS = ['合并分支', '推送分支'] as const;

/** 缺哪几项授权才能合并。null / undefined = 判据未知，放行；空数组 = 显式全关，
 *  照报两项（与 server 侧闸同判，见文件头 #994）。 */
export function missingMergeTools(tools: readonly string[] | null | undefined): string[] {
  if (tools == null) return [];
  return MERGE_GATE_TOOLS.filter((tool) => !tools.includes(tool));
}

/** 服务端拒绝的可见文案。4xx = server 带着可操作理由拒的（403 点名缺哪项
 *  授权、409 点名相位漂移/双 PR 守卫），原样透出——压成固定句会丢理由，还
 *  把「送出了被拒」说成「未送出」（#1236）。5xx / 网络失败的原文对用户不可
 *  操作，且网络级的原文是英文串，混进中文面反而更糊——退一句固定话（同律见
 *  agent-detail-page 的保存失败文案）；fallback 可覆写（不合并完成腿的失败
 *  不是「合并请求」）。 */
export function mergeRejectCopy(error: unknown, t: TFunc, fallback?: string): string {
  return error instanceof ApiError && error.status < 500 && error.message !== ''
    ? error.message
    : (fallback ?? t('合并请求未送出，请重试。'));
}

/** 执行 Agent 的授权集：live = GET teams/{id}/members 的 actor 投影（server
 *  侧 agentRecordOf 原样带出 tools 列）；fixture 面返回空（不拦）——fixture
 *  面的「完成」本就不发请求，拦它只会拦掉自己的静态态。 */
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
