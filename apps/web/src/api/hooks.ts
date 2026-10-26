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
import { threadTurnInFlight } from '../chief/orchestration-inflight.js';
import { api } from './client.js';

const CHIEF_THREADS_INFLIGHT_POLL_MS = 3000;

export type { ApiKeyRow, PlanRow };
export type StepRow = StepJournalRow;

export interface ProvidersEnvelope {
  presets: ProviderPreset[];
  providers: ProviderRecord[];
}

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
    staleTime: Number.POSITIVE_INFINITY,
  });

export const useProjects = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['projects', teamId],
    queryFn: () => api.get<ProjectRecord[]>(`/api/projects?teamId=${teamId}`),
    enabled: enabled && teamId !== undefined,
  });

export const useProjectAutonomy = (projectId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['project-autonomy', projectId],
    queryFn: () => api.get<AutonomyRecord>(`/api/projects/${projectId}/autonomy`),
    enabled: enabled && projectId !== undefined,
  });

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

export const useTags = (projectId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['tags', projectId],
    queryFn: () => api.get<TagRecord[]>(`/api/projects/${projectId}/tags`),
    enabled: enabled && projectId !== undefined,
  });

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

export const useModelSources = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['model-sources', teamId],
    queryFn: () => api.get<ModelSourcesEnvelope>(`/api/teams/${teamId}/model-sources`),
    enabled: enabled && teamId !== undefined,
    staleTime: 0,
  });

export const useCapabilities = (enabled: boolean) =>
  useQuery({
    queryKey: ['capabilities'],
    queryFn: () => api.get<CapabilitiesResponse>('/api/capabilities'),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  });

export interface FeishuBotStatus {
  configured: boolean;
  appId: string | null;
  openId: string | null;
  cairnOrigin: string | null;
}

export const useFeishuBot = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['feishu-bot', teamId],
    queryFn: () => api.get<FeishuBotStatus>(`/api/teams/${teamId}/feishu`),
    enabled: enabled && teamId !== undefined,
  });

export const useGithubConnection = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['github-connection', teamId],
    queryFn: () => api.get<GithubConnectionStatus>(`/api/teams/${teamId}/github/connection`),
    enabled: enabled && teamId !== undefined,
  });

export const useGithubRepos = (enabled: boolean) =>
  useQuery({
    queryKey: ['github-repos'],
    queryFn: () => api.get<GithubReposResponse>('/api/github/repos'),
    enabled,
  });

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
    refetchInterval: (query) =>
      query.state.data?.some(threadTurnInFlight) ? CHIEF_THREADS_INFLIGHT_POLL_MS : false,
  });

export const useNotifications = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['notifications', teamId],
    queryFn: () => api.get<{ unreadThreadIds: string[] }>(`/api/teams/${teamId}/notifications`),
    enabled: enabled && teamId !== undefined,
  });

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

export const useProjectFiles = (projectId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['files', projectId],
    queryFn: () =>
      api.get<ProjectFilesResponse>(`/api/projects/${projectId}/files`).catch(() => null),
    enabled: projectId !== undefined && enabled,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

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

export function useApiMutations(teamId: string | undefined) {
  const qc = useQueryClient();
  const invalidateAll = () => {
    void qc.invalidateQueries();
  };
  return {
    patchUser: useMutation({
      mutationFn: (body: PatchUserBody) => api.patch<UserRecord>('/api/user/me', body),
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: ['session'] });
      },
    }),
    createTodo: useMutation({
      mutationFn: (input: { projectId: string; spec: string; machineId?: string | null }) =>
        api.post<TodoRecord>(`/api/projects/${input.projectId}/todos`, {
          title: '',
          spec: input.spec,
          ...(input.machineId != null ? { machineId: input.machineId } : {}),
        }),
      onSuccess: invalidateAll,
    }),
    importGithubIssue: useMutation({
      mutationFn: (input: { projectId: string; number: number }) =>
        api.post<TodoRecord>(`/api/projects/${input.projectId}/github/issues/import`, {
          number: input.number,
        }),
      onSuccess: invalidateAll,
    }),
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
          | { action: 'review'; agentId?: string; focus: string }
          | { action: 'restart'; feedback: string; clientMessageId: string };
      }) => api.post<{ delegated: true }>(`/api/builds/${input.buildId}/steps`, input.body),
      onSuccess: invalidateAll,
    }),
    mergeBuild: useMutation({
      mutationFn: (buildId: string) =>
        api.post<{ delegated: true }>(`/api/builds/${buildId}/merge`, {}),
      onSuccess: invalidateAll,
    }),
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
    createProject: useMutation({
      mutationFn: (body: CreateProjectBody) =>
        api.post<ProjectRecord>('/api/projects', { ...body, ...(teamId ? { teamId } : {}) }),
      onSuccess: invalidateAll,
    }),
    patchProject: useMutation({
      mutationFn: (input: { id: string; body: PatchProjectBody }) =>
        api.patch<ProjectRecord>(`/api/projects/${input.id}`, input.body),
      onSuccess: invalidateAll,
    }),
    patchAutonomy: useMutation({
      mutationFn: (input: { id: string; body: PatchAutonomyBody }) =>
        api.patch<AutonomyRecord>(`/api/projects/${input.id}/autonomy`, input.body),
      onSuccess: (record, input) => {
        qc.setQueryData(['project-autonomy', input.id], record);
        invalidateAll();
      },
    }),
    pickLocalFolder: useMutation({
      mutationFn: () => api.post<FsPickResult>('/api/fs/pick'),
    }),
    deleteProject: useMutation({
      mutationFn: (id: string) => api.del<void>(`/api/projects/${id}`),
      onSuccess: invalidateAll,
    }),
    chiefSend: useMutation({
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
    chiefRewind: useMutation({
      mutationFn: (input: { threadId: string; messageId: string }) =>
        api.post<{ deletedCount: number; thread: ChiefThread }>(
          `/api/teams/${teamId}/chief/threads/${input.threadId}/rewind`,
          { messageId: input.messageId },
        ),
      onSuccess: invalidateAll,
    }),
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
    startProviderOAuth: useMutation({
      mutationFn: (presetId: string) =>
        api.post<OAuthAuthorizeResponse>(
          `/api/teams/${teamId}/providers/oauth/${presetId}/authorize`,
          {},
        ),
    }),
    startGithubOAuth: useMutation({
      mutationFn: () =>
        api.post<OAuthAuthorizeResponse>(`/api/teams/${teamId}/github/oauth/authorize`, {}),
    }),
    disconnectGithub: useMutation({
      mutationFn: () => api.del<void>(`/api/teams/${teamId}/github/connection`),
      onSuccess: invalidateAll,
    }),
    saveFeishuBot: useMutation({
      mutationFn: (body: {
        appId: string;
        appSecret: string;
        openId: string;
        cairnOrigin: string;
      }) => api.put<FeishuBotStatus>(`/api/teams/${teamId}/feishu`, body),
      onSuccess: invalidateAll,
    }),
    unbindFeishuBot: useMutation({
      mutationFn: () => api.del<void>(`/api/teams/${teamId}/feishu`),
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
      mutationFn: (body: {
        name: string | null;
        gitAccess: boolean;
        mcpAccess: boolean;
        toolGrants: { read: string[]; write: string[] };
      }) => api.post<ApiKeyRow & { plaintext?: string }>(`/api/teams/${teamId}/api-keys`, body),
      onSuccess: invalidateAll,
    }),
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
    importSkill: useMutation({
      mutationFn: (body: ImportSkillBody) =>
        api.post<SkillRecord>(`/api/teams/${teamId}/skills/import`, body),
      onSuccess: invalidateAll,
    }),
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
    deleteAgent: useMutation({
      mutationFn: (id: string) => api.del<void>(`/api/teams/${teamId}/agents/${id}`),
      onSuccess: invalidateAll,
    }),
    deleteMemory: useMutation({
      mutationFn: (input: { agentId: string; memoryId: string }) =>
        api.del<void>(`/api/teams/${teamId}/agents/${input.agentId}/memories/${input.memoryId}`),
      onSuccess: invalidateAll,
    }),
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
