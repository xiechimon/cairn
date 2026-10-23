// TanStack Query 数据层（M5，01 §4.1/S8 锁定：server state 全走查询失效
// 重取；SSE 事件仅作 invalidateQueries 提示信号——见 sse.ts）。
// 查询键词表 = 本文件 QK 单源；wire 类型单源 = @cairn/shared（02/A9）。

import type {
  AgentMachineFitResponse,
  AgentRecord,
  AgentTask,
  ApiKeyRow,
  AskUserAnswer,
  AskUserQuestionContent,
  Assignment,
  AutonomyRecord,
  BuildRecord,
  CapabilitiesResponse,
  ChiefGetResponse,
  ChiefThread,
  ConversationMessagesResponse,
  CreateAgentBody,
  CreateProjectBody,
  CreateProviderBody,
  CreateScheduleBody,
  CreateSkillBody,
  DiffFileContent,
  DocumentDiff,
  DocumentDiffFile,
  FsListResult,
  FsPickResult,
  GithubConnectionStatus,
  GithubIssueEcho,
  GithubIssueState,
  GithubIssuesResponse,
  GithubReposResponse,
  ImportSkillBody,
  MachineRecord,
  McpServerRecord,
  MemoryRecord,
  ModelSourcesEnvelope,
  OAuthAuthorizeResponse,
  PatchAgentBody,
  PatchAutonomyBody,
  PatchChiefBody,
  PatchMachineBody,
  PatchProjectBody,
  PatchUserBody,
  PlanRow,
  ProjectCommitDetailResponse,
  ProjectFileResponse,
  ProjectFilesResponse,
  ProjectRecord,
  ProjectTreeResponse,
  ProviderPreset,
  ProviderRecord,
  ScheduleRecord,
  SearchResponse,
  SecretRecord,
  SetSecretBody,
  SkillRecord,
  StepJournalRow,
  TagRecord,
  TeamMember,
  TeamRecord,
  TodoRecord,
  TokenUsage,
  UpdateSkillBody,
  UserRecord,
} from '@cairn/shared';
import { SKILL_ENTRY_FILE } from '@cairn/shared';
import {
  keepPreviousData,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api } from './client.js';

// 行形单源 = shared（01 §4.4 双端消费）：plan 行 = planRowSchema（record +
// content 透出 [推断] 封套）；steps 行 = stepJournalRowSchema（journal 位
// 透出 [设计]）；api-key 行 = apiKeyRowSchema（掩码投影，02 §8）。
export type { ApiKeyRow, PlanRow };
export type StepRow = StepJournalRow;

export interface ProvidersEnvelope {
  presets: ProviderPreset[];
  providers: ProviderRecord[];
}

// —— 查询 ————————————————————————————————————————————————————————————————

export const useSession = (enabled: boolean) =>
  useQuery({
    queryKey: ['session'],
    queryFn: () => api.get<UserRecord>('/api/user/me'),
    enabled,
  });

export const useTeams = (enabled: boolean) =>
  useQuery({
    queryKey: ['teams'],
    queryFn: () => api.get<TeamRecord[]>('/api/teams'),
    enabled,
    staleTime: Number.POSITIVE_INFINITY, // team 恒 seed 一行（02 §2.2）
  });

export const useProjects = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['projects', teamId],
    queryFn: () => api.get<ProjectRecord[]>(`/api/projects?teamId=${teamId}`),
    enabled: enabled && teamId !== undefined,
  });

/** #1491 后台自动任务的闸：设置 + 每种任务最近一次判定（项目设置页读）。 */
export const useProjectAutonomy = (projectId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['project-autonomy', projectId],
    queryFn: () => api.get<AutonomyRecord>(`/api/projects/${projectId}/autonomy`),
    enabled: enabled && projectId !== undefined,
  });

/** W4 #286：⌘K 面板 live 面服务端搜索——GET /api/search?q= 防抖 250ms
 * （击键间隔内不发出）；空串/未开面板不查。结果集直接喂 SearchPanel 的
 * server 位（fixture 面不经此钩）。 */
export function useSearchResults(query: string, enabled: boolean) {
  const debounced = useDebouncedValue(query, 250);
  const trimmed = debounced.trim();
  return useQuery({
    queryKey: ['search', trimmed],
    queryFn: () => api.get<SearchResponse>(`/api/search?q=${encodeURIComponent(trimmed)}`),
    enabled: enabled && trimmed !== '',
  });
}

function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** #309 标签集读面（r9 §3.4）：新建任务 dialog 面板与详情 fresh meta 区
 *  chip 的数据源；键随选中项目（标签属项目）。 */
export const useTags = (projectId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['tags', projectId],
    queryFn: () => api.get<TagRecord[]>(`/api/projects/${projectId}/tags`),
    enabled: enabled && projectId !== undefined,
  });

/** #403 看板标签筛选 + #445 卡片标签：看板是 team 面而标签属项目——全
 * 项目标签集并查（useRunHistoryTokens 同式；queryKey 与 useTags 同键，缓存
 * 共享去重），合成 tagId → 标签行（TagChipData 同形投影——卡面 chip 吃
 * name+color）与 tagId → 词表名（筛选谓词面）双解析图。ready = 全部查询
 * 落定：首载未完时调用面不得激活筛选，否则 tagged 卡会闪隐（map 空 =
 * 全部不命中）。 */
export function useProjectTags(projectIds: string[], enabled: boolean) {
  const queries = useQueries({
    queries: projectIds.map((id) => ({
      queryKey: ['tags', id],
      queryFn: () => api.get<TagRecord[]>(`/api/projects/${id}/tags`),
      enabled,
    })),
  });
  return useMemo(() => {
    const tagById = new Map<string, Pick<TagRecord, 'id' | 'name' | 'color'>>();
    const nameById = new Map<string, string>();
    // XMON-57：**有序**投影。扁平 map 丢掉了 projectId，「同名不同色取哪个」
    // 就无从判断；本数组按 queries 序（= projectIds 序 = 字典序规范序）
    // append，先到先得即「取规范序首个项目的那行」，buildTagOptions 吃它。
    const ordered: Pick<TagRecord, 'id' | 'name' | 'color'>[] = [];
    const seen = new Set<string>();
    for (const q of queries) {
      for (const tag of q.data ?? []) {
        if (seen.has(tag.id)) continue;
        seen.add(tag.id);
        ordered.push({ id: tag.id, name: tag.name, color: tag.color });
        tagById.set(tag.id, { id: tag.id, name: tag.name, color: tag.color });
        nameById.set(tag.id, tag.name);
      }
    }
    return { tagById, nameById, ordered, ready: queries.every((q) => !q.isPending) };
  }, [queries]);
}

export const useTodos = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['todos', teamId],
    queryFn: () => api.get<TodoRecord[]>(`/api/todos?teamId=${teamId}`),
    enabled: enabled && teamId !== undefined,
  });

export const useTodo = (id: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['todo', id],
    queryFn: () => api.get<TodoRecord>(`/api/todos/${id}`),
    enabled: enabled && id !== undefined,
  });

export const useBuild = (id: string | null | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['build', id],
    queryFn: () => api.get<BuildRecord>(`/api/builds/${id}`),
    enabled: enabled && id != null,
  });

export const useProjectBuilds = (projectId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['projectBuilds', projectId],
    queryFn: () => api.get<BuildRecord[]>(`/api/projects/${projectId}/builds`),
    enabled: enabled && projectId !== undefined,
  });

export const useSteps = (buildId: string | null | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['steps', buildId],
    queryFn: () => api.get<StepRow[]>(`/api/builds/${buildId}/steps`),
    enabled: enabled && buildId != null,
  });

export const useMessages = (conversationId: string | null | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['messages', conversationId],
    queryFn: () =>
      api.get<ConversationMessagesResponse>(`/api/conversations/${conversationId}/messages`),
    enabled: enabled && conversationId != null,
  });

export const usePlans = (buildId: string | null | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['plans', buildId],
    queryFn: () => api.get<PlanRow[]>(`/api/builds/${buildId}/plans`),
    enabled: enabled && buildId != null,
  });

export const useBuildChanges = (buildId: string | null | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['changes', buildId],
    queryFn: () =>
      api.get<{ files: DocumentDiffFile[]; reported?: boolean; changed?: boolean }>(
        `/api/builds/${buildId}/changes`,
      ),
    enabled: enabled && buildId != null,
  });

/** 单文件全文读面（#225 接 #224 端点，docpane changes 面「显示完整文件」）：
 *  conv 分支头单文件按需取。path 含 `/` 与中文，必须 encode（useProjectFile
 *  同律）。 */
export const useBuildChangeFile = (
  buildId: string | null | undefined,
  path: string | null,
  enabled: boolean,
) =>
  useQuery({
    queryKey: ['changeFile', buildId, path],
    queryFn: () =>
      api.get<DiffFileContent>(
        `/api/builds/${buildId}/changes/file?path=${encodeURIComponent(path ?? '')}`,
      ),
    enabled: enabled && buildId != null && path != null,
  });

export const useBuildUsage = (buildId: string | null | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['usage', buildId],
    queryFn: () => api.get<TokenUsage[]>(`/api/builds/${buildId}/usage`),
    enabled: enabled && buildId != null,
  });

/** W4 #288：运行历史 tokens 供数——buildHistory 各 build 的 usage 并查
 * （per-build 端点同键去重）→ Map<buildId, 四维合计>；未到的行缺省
 * （mapRunHistory tokensByBuild 槽省略不炸）。合计口径 = mapTokenUsage
 * 同式（input+output+cacheRead+cacheWrite）。 */
export function useRunHistoryTokens(buildIds: string[], enabled: boolean) {
  const queries = useQueries({
    queries: buildIds.map((id) => ({
      queryKey: ['usage', id],
      queryFn: () => api.get<TokenUsage[]>(`/api/builds/${id}/usage`),
      enabled,
      staleTime: 60_000,
    })),
  });
  return useMemo(() => {
    const byBuild = new Map<string, number>();
    buildIds.forEach((id, index) => {
      const rows = queries[index]?.data;
      if (!rows || rows.length === 0) return;
      byBuild.set(
        id,
        rows.reduce((sum, row) => sum + row.input + row.output + row.cacheRead + row.cacheWrite, 0),
      );
    });
    return byBuild;
  }, [buildIds, queries]);
}

export const useDocumentDiff = (
  documentId: string | null,
  againstVersion: number | null,
  enabled = true,
) =>
  useQuery({
    queryKey: ['documentDiff', documentId, againstVersion],
    queryFn: () =>
      api.get<DocumentDiff & { documentId: string }>(
        `/api/documents/${documentId}/diff${againstVersion != null ? `?againstVersion=${againstVersion}` : ''}`,
      ),
    enabled: enabled && documentId != null,
  });

export const useSchedules = (enabled: boolean) =>
  useQuery({
    queryKey: ['schedules'],
    queryFn: () => api.get<ScheduleRecord[]>('/api/schedules'),
    enabled,
  });

export const useMachines = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['machines', teamId],
    queryFn: () => api.get<MachineRecord[]>(`/api/teams/${teamId}/machines`),
    enabled: enabled && teamId !== undefined,
  });

export const useMembers = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['members', teamId],
    queryFn: () => api.get<TeamMember[]>(`/api/teams/${teamId}/members`),
    enabled: enabled && teamId !== undefined,
  });

export const useProviders = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['providers', teamId],
    queryFn: () => api.get<ProvidersEnvelope>(`/api/teams/${teamId}/providers`),
    enabled: enabled && teamId !== undefined,
  });

/** Agent 单条读面（r3 §4：GET agents/{aid} 词表内）——详情编辑页的真值源。
 *  团队页走 members 读面拿到的是展示投影（TeamAgentCard），缺职责/权限四组
 *  与 provider，够不着编辑面，故详情页直取全记录。 */
export const useAgent = (
  teamId: string | undefined,
  agentId: string | undefined,
  enabled: boolean,
) =>
  useQuery({
    queryKey: ['agent', teamId, agentId],
    queryFn: () => api.get<AgentRecord>(`/api/teams/${teamId}/agents/${agentId}`),
    enabled: enabled && teamId !== undefined && agentId !== undefined,
  });

/** Agent 记忆读面（02 §4.4/r5 §6：GET agents/{aid}/memories 词表内）。 */
export const useMemories = (
  teamId: string | undefined,
  agentId: string | undefined,
  enabled: boolean,
) =>
  useQuery({
    queryKey: ['memories', teamId, agentId],
    queryFn: () => api.get<MemoryRecord[]>(`/api/teams/${teamId}/agents/${agentId}/memories`),
    enabled: enabled && teamId !== undefined && agentId !== undefined,
  });

/** Agent 详情「进行中」段的数据源（词表内 r3 §8.2 观测路由；行形状 =
 *  shared AgentTask）。语义 = 该 Agent 名下正在跑的 build，**不是**「指派给
 *  它的 todo」——server 侧判据与实测反证见 routes.ts 同名端点注释。 */
export const useAgentTasks = (
  teamId: string | undefined,
  agentId: string | undefined,
  enabled: boolean,
) =>
  useQuery({
    queryKey: ['agentTasks', teamId, agentId],
    queryFn: () => api.get<AgentTask[]>(`/api/teams/${teamId}/agents/${agentId}/tasks`),
    enabled: enabled && teamId !== undefined && agentId !== undefined,
  });

/** Agent 机器匹配面（#1251 / ADR 0018 决策 4.6「哪些机器可跑它」）：
 *  requiredCapabilities × 各机上报快照的交集，判定单源在 server（claim/sweep
 *  同一份 dispatch-eligibility 原语）——读面不自算，防两套判据漂移。
 *  staleTime 0：能力快照随 30s 心跳上行，进页即取现值。 */
export const useAgentMachineFit = (
  teamId: string | undefined,
  agentId: string | undefined,
  enabled: boolean,
) =>
  useQuery({
    queryKey: ['agentMachineFit', teamId, agentId],
    queryFn: () =>
      api.get<AgentMachineFitResponse>(`/api/teams/${teamId}/agents/${agentId}/machine-fit`),
    enabled: enabled && teamId !== undefined && agentId !== undefined,
    staleTime: 0,
  });

// providers 页 runtime tabs 数据源（spec 11 §A3/A4，#356）：pi + claude-code
// 两段。staleTime 0 = 每次 mount 重取——claude-code 段承载「实时反映
// ~/.claude/settings.json」语义（server 侧每次 GET 重读文件）。
export const useModelSources = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['model-sources', teamId],
    queryFn: () => api.get<ModelSourcesEnvelope>(`/api/teams/${teamId}/model-sources`),
    enabled: enabled && teamId !== undefined,
    staleTime: 0,
  });

/** 能力读面（XMON-16 / #499 B3 裁决 A）：引擎能力词表——当前载荷 = 思考强度
 * 档位，Agent 详情只读行按它呈现档位。队无关（能力是引擎的事实，不随团队
 * 分叉），故路径不带 teamId。staleTime 恒新：词表随 server 构建期恒定，进程
 * 活着就不会变，重取只是空转。fixture 面不经此钩（无后端，直接取 shared
 * 单源 `THINKING_LEVELS`——那不是第二份真值，就是读面背后同一个常量）。 */
export const useCapabilities = (enabled: boolean) =>
  useQuery({
    queryKey: ['capabilities'],
    queryFn: () => api.get<CapabilitiesResponse>('/api/capabilities'),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  });

/** GitHub 连接认证状态读面（#361 G2-T4）：login/scope，无 token 位（02 §8）。
 *  enabled 由调用面收窄到 github 选态——页面挂载不空转。 */
export const useGithubConnection = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['github-connection', teamId],
    queryFn: () => api.get<GithubConnectionStatus>(`/api/teams/${teamId}/github/connection`),
    enabled: enabled && teamId !== undefined,
  });

/** repo picker 数据面（#359 端点，#361 消费）：单页 100 条一次取回，搜索
 *  过滤在调用面本地做（上游 /user/repos 无查询参数面，server q 为同值兜底）。 */
export const useGithubRepos = (enabled: boolean) =>
  useQuery({
    queryKey: ['github-repos'],
    queryFn: () => api.get<GithubReposResponse>('/api/github/repos'),
    enabled,
  });

/** 应用内目录浏览数据源（#441，ADR 0003 D6 remote/headless 兜底）：
 *  dir null = 缺省请求（server $HOME 起点，web 无从知道 server HOME）；
 *  queryKey 含 dir = 快速连点导航按键隔离（W4），keepPreviousData 防塌缩
 *  闪烁——下钻期间旧列表留显不闪空面。 */
export const useFsList = (dir: string | null, enabled: boolean) =>
  useQuery({
    queryKey: ['fs-list', dir],
    queryFn: () =>
      api.get<FsListResult>(
        dir === null ? '/api/fs/list' : `/api/fs/list?dir=${encodeURIComponent(dir)}`,
      ),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 0,
  });

/** 项目页「从 GitHub issue 建任务」选择器数据面（#446）：state/page 直透
 * server 代理面；enabled 收窄到弹层开态（关着不发请求，useGithubConnection
 * 同律）。 */
export function useGithubIssues(
  projectId: string | undefined,
  state: GithubIssueState,
  page: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['github-issues', projectId, state, page],
    queryFn: () =>
      api.get<GithubIssuesResponse>(
        `/api/projects/${projectId}/github/issues?state=${state}&page=${page}`,
      ),
    enabled: enabled && projectId !== undefined,
  });
}

/** 来源 issue 只读回显（#452 / ADR 0006 D5/D6）：详情页进入时拉一次——
 *  staleTime ∞ + retry 关：拉不到（未连接/token 失效/限流/issue 被删）整行
 *  隐藏，不轮询、不显示陈旧值、不弹错。enabled 收窄到 sourceRef 已落。 */
export function useGithubIssueEcho(todoId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['github-issue-echo', todoId],
    queryFn: () => api.get<GithubIssueEcho>(`/api/todos/${todoId}/github-issue`),
    enabled: enabled && todoId !== undefined,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export const useSecrets = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['secrets', teamId],
    queryFn: () => api.get<SecretRecord[]>(`/api/teams/${teamId}/secrets`),
    enabled: enabled && teamId !== undefined,
  });

export const useApiKeys = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['apiKeys', teamId],
    queryFn: () => api.get<ApiKeyRow[]>(`/api/teams/${teamId}/api-keys`),
    enabled: enabled && teamId !== undefined,
  });

export const useMcpServers = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['mcpServers', teamId],
    queryFn: () => api.get<McpServerRecord[]>(`/api/teams/${teamId}/mcp-servers`),
    enabled: enabled && teamId !== undefined,
  });

export const useSkills = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['skills', teamId],
    queryFn: () => api.get<SkillRecord[]>(`/api/skills?teamId=${teamId}`),
    enabled: enabled && teamId !== undefined,
  });

/** 单技能入口文件读面（XMON-114 编辑弹窗预填）：GET teams/{id}/skills/{sid}
 *  /file?fileName=SKILL.md。retry: false——404（目标刚被移除）是编辑面的
 *  一等错误态，重试只会拖慢呈现。 */
export const useSkillFile = (
  teamId: string | undefined,
  skillId: string | undefined,
  enabled: boolean,
) =>
  useQuery({
    queryKey: ['skillFile', teamId, skillId],
    queryFn: () =>
      api.get<{ fileName: string; content: string }>(
        `/api/teams/${teamId}/skills/${encodeURIComponent(skillId ?? '')}/file?fileName=${SKILL_ENTRY_FILE}`,
      ),
    enabled: enabled && teamId !== undefined && skillId !== undefined,
    retry: false,
  });

export const useChief = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['chief', teamId],
    queryFn: () => api.get<ChiefGetResponse>(`/api/teams/${teamId}/chief`),
    enabled: enabled && teamId !== undefined,
  });

export const useChiefThreads = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['chiefThreads', teamId],
    queryFn: () => api.get<ChiefThread[]>(`/api/teams/${teamId}/chief/threads`),
    enabled: enabled && teamId !== undefined,
  });

export const useNotifications = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['notifications', teamId],
    queryFn: () => api.get<{ unreadThreadIds: string[] }>(`/api/teams/${teamId}/notifications`),
    enabled: enabled && teamId !== undefined,
  });

/** 单层树读面。path = 子目录下钻（#1097）：缺省/空串 = 顶层；path 进
 *  queryKey——目录切换即换键，React Query 自然分缓存（在途态见
 *  project-page 的加载/空态分支）。 */
export const useProjectTree = (
  projectId: string | undefined,
  ref: string | undefined,
  path: string | undefined,
) =>
  useQuery({
    queryKey: ['tree', projectId, ref, path],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (ref !== undefined) qs.set('ref', ref);
      if (path !== undefined && path !== '') qs.set('path', path);
      const query = qs.toString();
      return api.get<ProjectTreeResponse>(
        `/api/projects/${projectId}/tree${query !== '' ? `?${query}` : ''}`,
      );
    },
    enabled: projectId !== undefined,
  });

/** 全递归文件列举（#760 composer `@` 候选源）：一次取回全仓路径表，客户端
 * 全量本地 fuzzy。失败（非 hosted 404 / 坏 ref / 未决）一律空集——补全候选
 * 是渐进增强面，取不到 = agents-only，不弹错（e2e stub 面 500 同理）。 */
export const useProjectFiles = (projectId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['files', projectId],
    queryFn: () =>
      api.get<ProjectFilesResponse>(`/api/projects/${projectId}/files`).catch(() => null),
    enabled: projectId !== undefined && enabled,
    // 失败已在 queryFn 内收敛为空（不是重试能修好的：404 非托管 / 大仓截断是
    // 服务端常态），且静默面不需要重试抖动。
    retry: false,
    // 路径表随 ref 变，ref 不在键里——stale 即重取由调用方 invalidate；默认
    // staleTime 之内复用同一快照，同一会话多次 `@` 不重复打全量。
    staleTime: 5 * 60 * 1000,
  });

/** 单文件读面(#202 文件查看器;02 §3 读裸库单文件,server 已在,
 *  wire.test INFERRED_ROUTES 登记)。path 含 `/` 与中文,必须 encode。 */
export const useProjectFile = (
  projectId: string | undefined,
  path: string | undefined,
  ref: string | undefined,
) =>
  useQuery({
    queryKey: ['file', projectId, path, ref],
    queryFn: () =>
      api.get<ProjectFileResponse>(
        `/api/projects/${projectId}/file?path=${encodeURIComponent(path ?? '')}${ref !== undefined ? `&ref=${encodeURIComponent(ref)}` : ''}`,
      ),
    enabled: projectId !== undefined && path !== undefined,
  });

/** 提交历史读面（#149 文件|历史 分段「历史」；[推断] 端点，wire.test
 *  INFERRED_ROUTES 登记）。 */
export const useProjectCommits = (projectId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['commits', projectId],
    queryFn: () =>
      api.get<{
        ref: string;
        commits: {
          sha: string;
          shortSha: string;
          message: string;
          authorName: string;
          at: number;
        }[];
      }>(`/api/projects/${projectId}/commits`),
    enabled: enabled && projectId !== undefined,
  });

/** 提交详情读面（#1102 历史行点击 → 该提交 diff；[推断] 端点，wire.test
 *  INFERRED_ROUTES 登记）。sha 进 queryKey——切换提交即换键，React Query
 *  自然分缓存，来回切换不串数据（tree 面 path 键同款纪律）。 */
export const useProjectCommitDetail = (
  projectId: string | undefined,
  sha: string | undefined,
  enabled: boolean,
) =>
  useQuery({
    queryKey: ['commit-detail', projectId, sha],
    queryFn: () =>
      api.get<ProjectCommitDetailResponse>(
        `/api/projects/${projectId}/commits/${encodeURIComponent(sha ?? '')}`,
      ),
    enabled: enabled && projectId !== undefined && sha !== undefined,
  });

// —— 变更（mutation 后失效重取 = S8 canon）———————————————————————————————

export function useApiMutations(teamId: string | undefined) {
  const qc = useQueryClient();
  const invalidateAll = () => {
    void qc.invalidateQueries();
  };
  return {
    // 改名写回（#1031）：PATCH /api/user/me。成功只失效 session 读面（名称
    // 单源，帐号页 + LiveDataBridge 共用 ['session'] 键），无需全量重取。不做
    // 乐观更新：失败时调用点（帐号页）toast 点名，行面停在服务端旧值。
    patchUser: useMutation({
      mutationFn: (body: PatchUserBody) => api.patch<UserRecord>('/api/user/me', body),
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: ['session'] });
      },
    }),
    createTodo: useMutation({
      // spec 15 #394：web 面不产标题——wire 上 title 恒空串 = server 派生占位
      // 标题（首行截断），执行 agent 接单后回填正式标题；标签 = 固定词表
      // agent 归类。chief/mcp 的显式标题路径不经此 hook（REST 契约不变）。
      mutationFn: (input: { projectId: string; spec: string; machineId?: string | null }) =>
        api.post<TodoRecord>(`/api/projects/${input.projectId}/todos`, {
          title: '',
          spec: input.spec,
          // #682：新建任务 dialog 机器 chip；null/缺省 = 自动（省略位）。
          ...(input.machineId != null ? { machineId: input.machineId } : {}),
        }),
      onSuccess: invalidateAll,
    }),
    // 从 GitHub issue 建任务（#446 / ADR 0005 读向）：server 现拉 issue +
    // 镜像同步 label 集 → 201 全 TodoRecord（标题/正文/多标签/来源两列已落）。
    importGithubIssue: useMutation({
      mutationFn: (input: { projectId: string; number: number }) =>
        api.post<TodoRecord>(`/api/projects/${input.projectId}/github/issues/import`, {
          number: input.number,
        }),
      onSuccess: invalidateAll,
    }),
    // 未建成重试（#452 / ADR 0006 D2）：来源 issue 建失败的任务显式重试；
    // 成功 → 失效重取（sourceRef 补上，回显行随之升级）。
    retryGithubIssue: useMutation({
      mutationFn: (todoId: string) =>
        api.post<TodoRecord>(`/api/todos/${todoId}/github-issue/retry`, {}),
      onSuccess: invalidateAll,
    }),
    patchTodo: useMutation({
      mutationFn: (input: {
        id: string;
        body: {
          title?: string;
          spec?: string;
          phase?: string;
          orderIndex?: number;
          tagIds?: string[];
          /** 指派槽级 patch(#209「编辑分配」接线;server #208 槽级 merge:
           *  提供的槽覆盖,未提供的槽保持现状)。 */
          assignment?: {
            plan?: NonNullable<Assignment['plan']>;
            build?: NonNullable<Assignment['build']>;
          };
        };
      }) => api.patch<TodoRecord>(`/api/todos/${input.id}`, input.body),
      onSuccess: invalidateAll,
    }),
    deleteTodo: useMutation({
      mutationFn: (id: string) => api.del<void>(`/api/todos/${id}`),
      onSuccess: invalidateAll,
    }),
    startBuilds: useMutation({
      mutationFn: (input: {
        projectId: string;
        todoIds: string[];
        assignment: Assignment;
        withPlan: boolean;
      }) =>
        api.post<{ builds: BuildRecord[] }>(`/api/projects/${input.projectId}/builds`, {
          todoIds: input.todoIds,
          assignment: input.assignment,
          withPlan: input.withPlan,
        }),
      onSuccess: invalidateAll,
    }),
    // 开始任务单出口（#640 / r14 §5.7）：直发总管编排回合——新 chief 线程
    // + 编排请求消息（任务原文逐字 = 锚点）+ chief 步入队。409 = 相位闸 /
    // 总管未绑定 Agent（调用面 toast 显性化，不静默）。
    orchestrateTodo: useMutation({
      mutationFn: (id: string) =>
        api.post<{
          thread: ChiefThread;
          message: { id: string; role: 'user'; content: string; createdAt: number };
        }>(`/api/todos/${id}/orchestrate`, {}),
      onSuccess: invalidateAll,
    }),
    stepAction: useMutation({
      mutationFn: (input: {
        buildId: string;
        body:
          | { action: 'confirm' }
          | { action: 'revision'; side: 'plan'; feedback: string; clientMessageId: string }
          // M7 #312 AI 审核（r8 §3.1）：入队审核步,可选 focus 入参透传 server。
          // #1250（ADR 0018 层 1）：agentId 可缺省——缺省 = fan-out 三视角
          //（server 按 persona 三员各入队一条 review 步）。
          | { action: 'review'; agentId?: string; focus: string }
          // #320 失败面发送 = 带反馈重启（r9 §3.3；shared buildStepActionBodySchema 同形）。
          | { action: 'restart'; feedback: string; clientMessageId: string };
      }) => api.post<{ delegated: true }>(`/api/builds/${input.buildId}/steps`, input.body),
      onSuccess: invalidateAll,
    }),
    mergeBuild: useMutation({
      mutationFn: (buildId: string) =>
        api.post<{ delegated: true }>(`/api/builds/${buildId}/merge`, {}),
      onSuccess: invalidateAll,
    }),
    // 停止钮（M7 #308，r9 §3.3）：discard = 「丢弃本轮修改」勾选位。
    // delegated:true = claimed 步机器信号在途（「正在停止…」过渡态由页面
    // 本地保持到 steps 重取见终态）；false = pending 步 server 即时取消。
    // 409（步已收尾竞态）同样 invalidate——数据面已前进，重取即收敛。
    stopBuild: useMutation({
      mutationFn: (input: { buildId: string; discard: boolean }) =>
        api.post<{ delegated: boolean }>(`/api/builds/${input.buildId}/stop`, {
          discard: input.discard,
        }),
      onSuccess: invalidateAll,
      onError: invalidateAll,
    }),
    createSchedule: useMutation({
      mutationFn: (body: CreateScheduleBody) => api.post<ScheduleRecord>('/api/schedules', body),
      onSuccess: invalidateAll,
    }),
    deleteSchedule: useMutation({
      mutationFn: (id: string) => api.del<void>(`/api/schedules/${id}`),
      onSuccess: invalidateAll,
    }),
    // 机器记录写回（spec 11 A8/A9，#357；XMON-113 起承载 shellEnabled 开关）。
    // body 单字段可选、缺省字段不动（shared patchMachineBodySchema，XMON-108
    // R1 起）——故这里只发调用点给的那个字段：连带发 enabledRuntimes 会按该
    // 列的全量替换语义把现值洗掉。乐观更新 + 失败回滚到快照（onMutate 的
    // 返回值）：失败时若只发 invalidate，重取请求在网络故障下同样失败，界面
    // 会停在那个从未落库的值上。成功才 invalidate = 用服务端回执收口。
    patchMachine: useMutation({
      mutationFn: (input: { id: string; body: PatchMachineBody }) =>
        api.patch<MachineRecord>(`/api/machines/${input.id}`, input.body),
      onMutate: (input) => {
        const previous = qc.getQueryData<MachineRecord[]>(['machines', teamId]);
        qc.setQueryData<MachineRecord[]>(['machines', teamId], (rows) =>
          (rows ?? []).map((m) => {
            if (m.id !== input.id) return m;
            const { maxConcurrent, ...rest } = input.body;
            if (maxConcurrent === null) {
              return {
                ...m,
                ...rest,
                maxConcurrentOverridden: false,
                maxConcurrent: m.recommendedConcurrent ?? m.maxConcurrent,
                concurrencySource:
                  m.capabilities?.hardware?.memoryTotalMb !== undefined ? 'measured' : 'estimate',
              };
            }
            return {
              ...m,
              ...rest,
              ...(maxConcurrent !== undefined
                ? { maxConcurrent, maxConcurrentOverridden: true, concurrencySource: 'manual' }
                : {}),
            };
          }),
        );
        return { previous };
      },
      onSuccess: invalidateAll,
      onError: (_error, _input, context) => {
        qc.setQueryData<MachineRecord[]>(['machines', teamId], context?.previous ?? []);
      },
    }),
    // body 单源 = shared createProjectBodySchema（spec 12 / #360：kind +
    // localPath / githubRepo 契约面；既有 repoKind 调用点同义兼容）。
    createProject: useMutation({
      mutationFn: (body: CreateProjectBody) =>
        api.post<ProjectRecord>('/api/projects', { ...body, ...(teamId ? { teamId } : {}) }),
      onSuccess: invalidateAll,
    }),
    // #1213/ADR 0017：github 形态项目 localPath 加速位写面（设置页字段）。
    // body 单源 = shared patchProjectBodySchema——清除必须发**显式 null**
    // （缺键 = 不动是另一态，#1169 序列化坑族：undefined 会被 stringify 丢键）。
    patchProject: useMutation({
      mutationFn: (input: { id: string; body: PatchProjectBody }) =>
        api.patch<ProjectRecord>(`/api/projects/${input.id}`, input.body),
      onSuccess: invalidateAll,
    }),
    // #1491 闸设置写面：缺键不动（shared patchAutonomyBodySchema）。
    patchAutonomy: useMutation({
      mutationFn: (input: { id: string; body: PatchAutonomyBody }) =>
        api.patch<AutonomyRecord>(`/api/projects/${input.id}/autonomy`, input.body),
      // 应答即新真值：先落缓存，设置页清草稿时不回闪旧值。
      onSuccess: (record, input) => {
        qc.setQueryData(['project-autonomy', input.id], record);
        invalidateAll();
      },
    }),
    // #440 原生文件夹选取（ADR 0003）：取消 = {path:null} 正常结局非错误面；
    // 纯读取动作，无缓存失效。
    pickLocalFolder: useMutation({
      mutationFn: () => api.post<FsPickResult>('/api/fs/pick'),
    }),
    // #189 删除面(#207 接线):级联语义单源在 server services/projects.ts。
    deleteProject: useMutation({
      mutationFn: (id: string) => api.del<void>(`/api/projects/${id}`),
      onSuccess: invalidateAll,
    }),
    chiefSend: useMutation({
      // #774 收单回落：响应带 modelFallback（被愈合掉的存量原值，无回落 null；
      // 可空 = 老 server 混跑窗口容忍缺失，缺席即无回落语义）。
      mutationFn: (input: { threadId: string | null; content: string }) =>
        input.threadId === null
          ? api.post<{ thread: ChiefThread }>(`/api/teams/${teamId}/chief/threads`, {
              content: input.content,
            })
          : api.post<{ thread: ChiefThread }>(`/api/conversations/${input.threadId}/messages`, {
              content: input.content,
            }),
      onSuccess: invalidateAll,
    }),
    // #615 返工：恢复钮「恢复到此处」闭环（server 截断锚后消息 + 重置会话 +
    // 锚内容重入队；invalidateAll 重取回显，S8 不持本地乐观态）。
    chiefRewind: useMutation({
      mutationFn: (input: { threadId: string; messageId: string }) =>
        api.post<{ deletedCount: number; thread: ChiefThread }>(
          `/api/teams/${teamId}/chief/threads/${input.threadId}/rewind`,
          { messageId: input.messageId },
        ),
      onSuccess: invalidateAll,
    }),
    // #1049 问答卡：答题/取消（S8 同律——不持乐观态，答毕 SSE message 事件 +
    // invalidateAll 重取翻面；409（已答/已取消）走 onError toast）。
    chiefAnswerQuestion: useMutation({
      mutationFn: (input: { threadId: string; requestId: string; answers: AskUserAnswer[] }) =>
        api.post<AskUserQuestionContent>(
          `/api/teams/${teamId}/chief/threads/${input.threadId}/questions/${input.requestId}/answer`,
          { answers: input.answers },
        ),
      onSuccess: invalidateAll,
    }),
    chiefCancelQuestion: useMutation({
      mutationFn: (input: { threadId: string; requestId: string }) =>
        api.post<{ ok: boolean }>(
          `/api/teams/${teamId}/chief/threads/${input.threadId}/questions/${input.requestId}/cancel`,
          {},
        ),
      onSuccess: invalidateAll,
    }),
    patchChief: useMutation({
      mutationFn: (body: PatchChiefBody) =>
        api.patch<ChiefGetResponse>(`/api/teams/${teamId}/chief`, body),
      onSuccess: invalidateAll,
    }),
    createProvider: useMutation({
      mutationFn: (body: CreateProviderBody) =>
        api.post<ProviderRecord>(`/api/teams/${teamId}/providers`, body),
      onSuccess: invalidateAll,
    }),
    // #231 OAuth 握手：签发授权 URL 后整页跳走（同页签流）——成功不
    // invalidate（回跳 = 全量重载），失败留页 inline 呈现。
    startProviderOAuth: useMutation({
      mutationFn: (presetId: string) =>
        api.post<OAuthAuthorizeResponse>(
          `/api/teams/${teamId}/providers/oauth/${presetId}/authorize`,
          {},
        ),
    }),
    // #361 GitHub 连接认证：startProviderOAuth 同律（同页签整页跳走，成功
    // 不 invalidate——回跳 = 全量重载；失败留页 inline 呈现）。
    startGithubOAuth: useMutation({
      mutationFn: () =>
        api.post<OAuthAuthorizeResponse>(`/api/teams/${teamId}/github/oauth/authorize`, {}),
    }),
    // 断开 = 删行幂等（server DAO 单点）；invalidate 收敛 connection/repos 读面。
    disconnectGithub: useMutation({
      mutationFn: () => api.del<void>(`/api/teams/${teamId}/github/connection`),
      onSuccess: invalidateAll,
    }),
    deleteProvider: useMutation({
      mutationFn: (id: string) => api.del<void>(`/api/teams/${teamId}/providers/${id}`),
      onSuccess: invalidateAll,
    }),
    createSecret: useMutation({
      mutationFn: (body: SetSecretBody) =>
        api.post<SecretRecord>(`/api/teams/${teamId}/secrets`, body),
      onSuccess: invalidateAll,
    }),
    deleteSecret: useMutation({
      mutationFn: (id: string) => api.del<void>(`/api/teams/${teamId}/secrets/${id}`),
      onSuccess: invalidateAll,
    }),
    createApiKey: useMutation({
      // W4 #287：全表单 body（r3 §6 权限位弹窗；形状 = server routes 的
      // createApiKeyBodySchema 同构——apiKeyRecordSchema + name 可选）。
      mutationFn: (body: {
        name: string | null;
        gitAccess: boolean;
        mcpAccess: boolean;
        toolGrants: { read: string[]; write: string[] };
      }) => api.post<ApiKeyRow & { plaintext?: string }>(`/api/teams/${teamId}/api-keys`, body),
      onSuccess: invalidateAll,
    }),
    // 技能写面（XMON-114 S3，spec 13 回摆）：新建 = POST /api/skills，
    // 编辑 = PUT teams/{id}/skills/{sid}（覆写语义：列出者覆写、未列者
    // 保留——弹窗只列 SKILL.md，其余文件原样保留）。成功失效重取列表即现。
    createSkill: useMutation({
      mutationFn: (body: CreateSkillBody) =>
        api.post<SkillRecord>(`/api/skills?teamId=${teamId}`, body),
      onSuccess: invalidateAll,
    }),
    updateSkill: useMutation({
      mutationFn: (input: { id: string; body: UpdateSkillBody }) =>
        api.put<SkillRecord>(
          `/api/teams/${teamId}/skills/${encodeURIComponent(input.id)}`,
          input.body,
        ),
      onSuccess: invalidateAll,
    }),
    // 技能导入（#1170）：POST teams/{id}/skills/import（localPath / GitHub URL
    // 二选一）；成功失效重取列表即现。错误面（400 校验 / 409 同名 / 502·504
    // 上游）由弹窗按 status 分译——这里不吞。
    importSkill: useMutation({
      mutationFn: (body: ImportSkillBody) =>
        api.post<SkillRecord>(`/api/teams/${teamId}/skills/import`, body),
      onSuccess: invalidateAll,
    }),
    // mcp-servers 无 mutation 面（spec 13 #368：MCP = 本机 ~/.claude.json
    // 只读投影，无建/改/删端点）。
    createAgent: useMutation({
      mutationFn: (body: CreateAgentBody) =>
        api.post<{ id: string }>(`/api/teams/${teamId}/agents`, body),
      onSuccess: invalidateAll,
    }),
    patchAgent: useMutation({
      mutationFn: (input: { id: string; body: PatchAgentBody }) =>
        api.patch<AgentRecord>(`/api/teams/${teamId}/agents/${input.id}`, input.body),
      onSuccess: invalidateAll,
    }),
    // 删除 Agent（XMON-19/B2：DELETE_FACE 'teams/{id}/agents/{aid}' 同名
    // DELETE）。关联面取舍（memories 不级联 / assignment 摘槽 / chief 摘绑定）
    // 在 server services/agents.ts，本层只发请求。
    deleteAgent: useMutation({
      mutationFn: (id: string) => api.del<void>(`/api/teams/${teamId}/agents/${id}`),
      onSuccess: invalidateAll,
    }),
    // 记忆删除（02 §4.4 词表内 DELETE；r5 §6 条目卡删除图标）。
    deleteMemory: useMutation({
      mutationFn: (input: { agentId: string; memoryId: string }) =>
        api.del<void>(`/api/teams/${teamId}/agents/${input.agentId}/memories/${input.memoryId}`),
      onSuccess: invalidateAll,
    }),
    // W3 steer（#280，06 册 D9）：build 会话运行中补话——POST messages 的
    // build 分支（#278 server 面）。成功 = 会话流 message 事件驱动重取（SSE
    // 兜底之外这里再失效一次）；失败（409 无在跑步）由调用面呈现，输入保留。
    sendSteer: useMutation({
      mutationFn: (input: { conversationId: string; content: string }) =>
        api.post<{ message: { id: string } }>(
          `/api/conversations/${input.conversationId}/messages`,
          { content: input.content },
        ),
      onSuccess: (_data, input) => {
        void qc.invalidateQueries({ queryKey: ['messages', input.conversationId] });
      },
    }),
  };
}

export type ApiMutations = ReturnType<typeof useApiMutations>;
