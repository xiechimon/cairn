import type {
  ApiKeyRow,
  AskUserAnswer,
  AskUserQuestionContent,
  AutonomyRecord,
  BuildRecord,
  CapabilitiesResponse,
  ChiefGetResponse,
  ChiefThread,
  ComputerCommandsResponse,
  ComputerRecord,
  ConversationMessagesResponse,
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
  MergeReadiness,
  ModelSourcesEnvelope,
  NotificationRecord,
  NotificationsResponse,
  OAuthAuthorizeResponse,
  PairedDevice,
  PairingCodeResponse,
  PatchAutonomyBody,
  PatchChiefBody,
  PatchMachineBody,
  PatchProjectBody,
  PatchProviderBody,
  PatchScheduleBody,
  PatchTeamBody,
  PatchUserBody,
  PlanResponse as PlanRow,
  ProjectFilesResponse,
  ProjectRecord,
  ProviderPreset,
  ProviderRecord,
  ProviderTestResult,
  PrPanelRow,
  RemoteRoutesResponse,
  RetroProposal,
  RouteOverride,
  ScheduleRecord,
  SearchResponse,
  SecretRecord,
  SetSecretBody,
  SkillRecord,
  StepJournalRow,
  TeamMember,
  TeamRecord,
  ThreadMessageResult,
  TodoRecord,
  TokenUsage,
  TranscriptRow,
  UpdateSkillBody,
  UserRecord,
  XaiDevicePollResponse,
  XaiDeviceStartResponse,
} from '@cairn/shared';
import {
  backupHealthSchema,
  backupNotice,
  SKILL_ENTRY_FILE,
  tasksQuerySchema,
} from '@cairn/shared';
import {
  type InfiniteData,
  InfiniteQueryObserver,
  infiniteQueryOptions,
  keepPreviousData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { threadTurnInFlight } from '../chief/orchestration-inflight.js';
import { useAuth } from './auth.js';
import { api } from './client.js';
import { computerQueryKeys } from './computer-query-scope.js';
import { cacheUserMessage } from './message-cache.js';
import { resumeRefreshDelayMs } from './resume-refresh-delay.js';
import { keepNewerTasks, keepNewerTodo, keepNewerTodos } from './todo-freshness.js';

const CHIEF_THREADS_INFLIGHT_POLL_MS = 3000;
const BACKUP_HEALTH_POLL_MS = 5 * 60 * 1000;
const STREAM_KEPT_FRESH_MS = 60_000;
const PREFETCH_FRESH_MS = 10_000;

export type { ApiKeyRow, PlanRow };
export type StepRow = StepJournalRow;

export interface ProvidersEnvelope {
  presets: ProviderPreset[];
  providers: ProviderRecord[];
  canTestConnection?: boolean;
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

export const todosQuery = (teamId: string | undefined) => ({
  queryKey: ['todos', teamId],
  queryFn: () => api.get<TodoRecord[]>(`/api/todos?teamId=${teamId}`),
  structuralSharing: keepNewerTodos,
});

export const useTodos = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    ...todosQuery(teamId),
    enabled: enabled && teamId !== undefined,
    staleTime: STREAM_KEPT_FRESH_MS,
  });

export const useArchivedTodos = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['todos', teamId, 'archived'],
    queryFn: () => api.get<TodoRecord[]>(`/api/todos?teamId=${teamId}&archived=1`),
    enabled: enabled && teamId !== undefined,
  });

export const tasksQuery = (teamId: string | undefined) => ({
  queryKey: ['tasks', teamId],
  queryFn: async () =>
    tasksQuerySchema.parse(await api.get(`/api/tasks?teamId=${teamId}&sectioned=1`)),
  structuralSharing: keepNewerTasks,
});

export const useTasks = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    ...tasksQuery(teamId),
    enabled: enabled && teamId !== undefined,
    staleTime: STREAM_KEPT_FRESH_MS,
  });

export const todoQuery = (id: string | undefined) => ({
  queryKey: ['todo', id],
  queryFn: () => api.get<TodoRecord>(`/api/todos/${id}`),
  structuralSharing: keepNewerTodo,
});

export const useTodo = (id: string | undefined, enabled: boolean) =>
  useQuery({ ...todoQuery(id), enabled: enabled && id !== undefined });

export const useBuild = (id: string | null | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['build', id],
    queryFn: () => api.get<BuildRecord>(`/api/builds/${id}`),
    enabled: enabled && id != null,
  });

export const useBuildGate = (buildId: string | null | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['buildGate', buildId],
    queryFn: () =>
      api.get<{ state: (MergeReadiness & { evaluatedAt: number }) | null }>(
        `/api/builds/${buildId}/gate`,
      ),
    enabled: enabled && buildId != null,
  });

export const PR_POLL_MS = 30_000;

export const usePrs = (
  teamId: string | undefined,
  threadId: string | undefined,
  enabled: boolean,
) =>
  useQuery({
    queryKey: ['prs', teamId, threadId ?? null],
    queryFn: () =>
      api.get<PrPanelRow[]>(
        threadId !== undefined ? `/api/prs?threadId=${encodeURIComponent(threadId)}` : '/api/prs',
      ),
    enabled: enabled && teamId !== undefined,
    refetchInterval: PR_POLL_MS,
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

const conversationMessagesQuery = (conversationId: string | null | undefined) =>
  infiniteQueryOptions({
    queryKey: ['messages', conversationId, 'pages'],
    queryFn: ({ pageParam }) =>
      api.get<ConversationMessagesResponse>(
        `/api/conversations/${conversationId}/messages${
          pageParam !== null ? `?before=${encodeURIComponent(pageParam)}` : ''
        }`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (typeof last.nextCursor === 'string' ? last.nextCursor : null),
  });

export function useWarmConversationMessages(
  retainedIds: readonly string[],
  prefetchId: string | null,
): void {
  const queryClient = useQueryClient();
  const retained = retainedIds.join('\n');
  useEffect(() => {
    if (retained === '') return;
    const releases = retained.split('\n').map((conversationId) =>
      new InfiniteQueryObserver(queryClient, {
        ...conversationMessagesQuery(conversationId),
        enabled: false,
      }).subscribe(() => {}),
    );
    return () => {
      for (const release of releases) release();
    };
  }, [retained, queryClient]);
  useEffect(() => {
    if (prefetchId === null) return;
    void queryClient.prefetchInfiniteQuery({
      ...conversationMessagesQuery(prefetchId),
      staleTime: PREFETCH_FRESH_MS,
    });
  }, [prefetchId, queryClient]);
}

export function prefetchThread(qc: QueryClient, teamId: string, todoId: string): void {
  void qc.prefetchQuery({ ...todoQuery(todoId), staleTime: PREFETCH_FRESH_MS });
  const buildId = qc
    .getQueryData<TodoRecord[]>(['todos', teamId])
    ?.find((todo) => todo.id === todoId)?.latestBuildId;
  if (buildId == null) return;
  void qc.prefetchInfiniteQuery({
    ...conversationMessagesQuery(buildId),
    staleTime: PREFETCH_FRESH_MS,
  });
}

export function useConversationMessages(
  conversationId: string | null | undefined,
  enabled: boolean,
) {
  const query = useInfiniteQuery({
    ...conversationMessagesQuery(conversationId),
    enabled: enabled && conversationId != null,
  });
  const messages = useMemo(
    () => [...(query.data?.pages ?? [])].reverse().flatMap((page) => page.messages),
    [query.data],
  );
  return { query, messages, newest: query.data?.pages[0] };
}

type MessagePages = InfiniteData<ConversationMessagesResponse, string | null>;

export async function keepNewestMessagesPage(
  queryClient: QueryClient,
  conversationId: string,
): Promise<void> {
  const queryKey = ['messages', conversationId, 'pages'];
  if ((queryClient.getQueryData<MessagePages>(queryKey)?.pages.length ?? 0) <= 1) return;
  await queryClient.cancelQueries({ queryKey, exact: true });
  queryClient.setQueryData<MessagePages>(queryKey, (data) =>
    data === undefined || data.pages.length <= 1
      ? data
      : { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) },
  );
}

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

export function useComputers(
  teamId: string | undefined,
  enabled: boolean,
  refetchIntervalMs?: number,
) {
  const auth = useAuth();
  return useQuery({
    queryKey: computerQueryKeys(teamId, auth.generation).computers,
    queryFn: async () =>
      (await api.get<{ computers: ComputerRecord[] }>('/api/computers')).computers,
    enabled: enabled && teamId !== undefined && !auth.gateOpen,
    ...(refetchIntervalMs !== undefined ? { refetchInterval: refetchIntervalMs } : {}),
  });
}

export function useComputerCommands(teamId: string | undefined, computerId: string | undefined) {
  const auth = useAuth();
  return useQuery({
    queryKey: [...computerQueryKeys(teamId, auth.generation).commands, computerId],
    queryFn: async () =>
      (await api.get<ComputerCommandsResponse>(`/api/computers/${computerId}/commands?limit=50`))
        .commands,
    enabled: teamId !== undefined && computerId !== undefined && !auth.gateOpen,
  });
}

export const useBackupNotice = (enabled: boolean) =>
  useQuery({
    queryKey: ['server-backup'],
    queryFn: async () =>
      backupNotice(
        backupHealthSchema.safeParse(await api.get('/api/server/backup')).data,
        Date.now(),
      ),
    enabled,
    refetchInterval: BACKUP_HEALTH_POLL_MS,
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

export const useMemories = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['memories', teamId],
    queryFn: () => api.get<MemoryRecord[]>(`/api/teams/${teamId}/memories`),
    enabled: enabled && teamId !== undefined,
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

const REMOTE_POLL_MS = 10_000;
const DEVICES_POLL_MS = 3_000;

export const useRemoteRoutes = (enabled: boolean) =>
  useQuery({
    queryKey: ['remoteRoutes'],
    queryFn: () => api.get<RemoteRoutesResponse>('/api/remote/routes'),
    enabled,
    refetchInterval: REMOTE_POLL_MS,
  });

export const useRemoteDevices = (enabled: boolean) =>
  useQuery({
    queryKey: ['remoteDevices'],
    queryFn: () => api.get<PairedDevice[]>('/api/remote/devices'),
    enabled,
    retry: false,
    refetchInterval: DEVICES_POLL_MS,
  });

export function useRemoteMutations() {
  const queryClient = useQueryClient();
  return {
    createPairingCode: useMutation({
      mutationFn: () => api.post<PairingCodeResponse>('/api/remote/pairing', {}),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pairingGrants'] }),
    }),
    revokeDevice: useMutation({
      mutationFn: (id: string) => api.del<void>(`/api/remote/devices/${encodeURIComponent(id)}`),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['remoteDevices'] }),
    }),
    revokePairingCode: useMutation({
      mutationFn: (id: string) => api.del<void>(`/api/remote/pairing/${encodeURIComponent(id)}`),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pairingGrants'] }),
    }),
  };
}

export const usePairingGrants = (enabled: boolean) =>
  useQuery({
    queryKey: ['pairingGrants'],
    queryFn: () =>
      api.get<Array<{ id: string; expiresAt: number; createdAt: number }>>('/api/remote/pairing'),
    enabled,
    refetchInterval: DEVICES_POLL_MS,
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

export function useChief(teamId: string | undefined, enabled: boolean, threadId?: string | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['chief', teamId, threadId ?? null],
    queryFn: () => {
      const q =
        threadId != null && threadId !== '' ? `?threadId=${encodeURIComponent(threadId)}` : '';
      return api.get<ChiefGetResponse>(`/api/teams/${teamId}/chief${q}`);
    },
    enabled: enabled && teamId !== undefined,
  });
  const resumeExpiresInMs = query.data?.context?.resumeExpiresInMs;
  const dataUpdatedAt = query.dataUpdatedAt;
  useEffect(() => {
    if (!enabled || teamId === undefined || resumeExpiresInMs == null) return;
    const timer = window.setTimeout(() => {
      void qc.invalidateQueries({ queryKey: ['chief', teamId, threadId ?? null] });
    }, resumeRefreshDelayMs(resumeExpiresInMs));
    return () => window.clearTimeout(timer);
  }, [enabled, teamId, threadId, resumeExpiresInMs, dataUpdatedAt, qc]);
  return query;
}

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
    queryFn: () => api.get<NotificationsResponse>(`/api/teams/${teamId}/notifications`),
    enabled: enabled && teamId !== undefined,
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

export function usePatchProject(teamId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; body: PatchProjectBody }) =>
      api.patch<ProjectRecord>(`/api/projects/${input.id}`, input.body),
    onSuccess: (record) => {
      qc.setQueryData<ProjectRecord[]>(['projects', teamId], (records) =>
        records?.map((project) => (project.id === record.id ? record : project)),
      );
      void qc.invalidateQueries();
    },
  });
}

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
    patchTeam: useMutation({
      mutationFn: (body: PatchTeamBody) =>
        api.patch<TeamRecord>(`/api/teams/${encodeURIComponent(teamId ?? '')}`, body),
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: ['teams'] });
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
          projectId?: string;
          routeOverride?: RouteOverride | null;
        };
      }) => api.patch<TodoRecord>(`/api/todos/${input.id}`, input.body),
      onSuccess: invalidateAll,
    }),
    runTodoOn: useMutation({
      mutationFn: (input: { todoId: string; machineId: string }) =>
        api.post<TodoRecord>(`/api/todos/${input.todoId}/runner`, { machineId: input.machineId }),
      onSuccess: invalidateAll,
    }),
    stopAndDoneTodo: useMutation({
      mutationFn: (id: string) =>
        api.post<{ state: 'stopping' | 'done'; todo: TodoRecord }>(
          `/api/todos/${id}/stop-and-done`,
          {},
        ),
      onSuccess: invalidateAll,
      onError: invalidateAll,
    }),
    resetTodo: useMutation({
      mutationFn: (input: { id: string; expectedPhase: string; expectedBuildId: string | null }) =>
        api.post<TodoRecord>(`/api/todos/${input.id}/reset`, {
          expectedPhase: input.expectedPhase,
          expectedBuildId: input.expectedBuildId,
        }),
      onSuccess: invalidateAll,
    }),
    setTodoArchived: useMutation({
      mutationFn: (input: { id: string; archived: boolean }) =>
        api.post<TodoRecord>(`/api/todos/${input.id}/${input.archived ? 'archive' : 'unarchive'}`),
      onMutate: async (input) => {
        await Promise.all([
          qc.cancelQueries({ queryKey: ['todo', input.id] }),
          qc.cancelQueries({ queryKey: ['todos', teamId] }),
        ]);
        const previous = qc.getQueryData<TodoRecord>(['todo', input.id]);
        const previousList = qc.getQueryData<TodoRecord[]>(['todos', teamId]);
        const archivedAt = input.archived ? Date.now() : null;
        qc.setQueryData<TodoRecord>(['todo', input.id], (record) =>
          record ? { ...record, archivedAt } : record,
        );
        qc.setQueryData<TodoRecord[]>(['todos', teamId], (records) =>
          records?.map((record) => (record.id === input.id ? { ...record, archivedAt } : record)),
        );
        return { previous, previousList };
      },
      onSuccess: (record) => {
        qc.setQueryData(['todo', record.id], record);
        qc.setQueryData<TodoRecord[]>(['todos', teamId], (records) =>
          records?.map((row) => (row.id === record.id ? record : row)),
        );
        invalidateAll();
      },
      onError: (_error, input, context) => {
        qc.setQueryData(['todo', input.id], context?.previous);
        qc.setQueryData(['todos', teamId], context?.previousList);
      },
    }),
    deleteTodo: useMutation({
      mutationFn: (id: string) => api.del<void>(`/api/todos/${id}`),
      onSuccess: invalidateAll,
    }),
    setThreadRead: useMutation({
      mutationFn: (input: { id: string; read: boolean }) =>
        api.post<NotificationRecord>(
          `/api/teams/${encodeURIComponent(teamId ?? '')}/notifications/${encodeURIComponent(input.id)}/${input.read ? 'read' : 'unread'}`,
        ),
      onMutate: async (input) => {
        await qc.cancelQueries({ queryKey: ['notifications', teamId] });
        qc.setQueryData<NotificationsResponse>(['notifications', teamId], (data) => {
          const ids = (data?.unreadThreadIds ?? []).filter((id) => id !== input.id);
          return { unreadThreadIds: input.read ? ids : [...ids, input.id] };
        });
      },
      onSettled: () => {
        void qc.invalidateQueries({ queryKey: ['notifications', teamId] });
      },
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
    patchSchedule: useMutation({
      mutationFn: (input: { id: string; body: PatchScheduleBody }) =>
        api.patch<ScheduleRecord>(`/api/schedules/${input.id}`, input.body),
      onSuccess: invalidateAll,
    }),
    deleteSchedule: useMutation({
      mutationFn: (id: string) => api.del<void>(`/api/schedules/${id}`),
      onSuccess: invalidateAll,
    }),
    runSchedule: useMutation({
      mutationFn: (id: string) => api.post<ScheduleRecord>(`/api/schedules/${id}/run`, {}),
      onSuccess: invalidateAll,
      onError: invalidateAll,
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
    patchProject: usePatchProject(teamId),
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
    setProjectArchived: useMutation({
      mutationFn: (input: { id: string; archived: boolean }) =>
        api.post<ProjectRecord>(
          `/api/projects/${input.id}/${input.archived ? 'archive' : 'unarchive'}`,
        ),
      onSuccess: invalidateAll,
    }),
    deleteProject: useMutation({
      mutationFn: (id: string) => api.del<void>(`/api/projects/${id}`),
      onSuccess: invalidateAll,
    }),
    chiefSend: useMutation({
      mutationFn: (input: {
        threadId: string | null;
        content: string;
        projectId?: string | null;
        clientMessageId?: string;
      }) => {
        const body = {
          content: input.content,
          ...(input.projectId != null ? { projectId: input.projectId } : {}),
          ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
        };
        return input.threadId === null
          ? api.post<{ thread: ChiefThread; message: TranscriptRow }>(
              `/api/teams/${teamId}/chief/threads`,
              body,
            )
          : api.post<{ thread: ChiefThread; message: TranscriptRow }>(
              `/api/conversations/${input.threadId}/messages`,
              body,
            );
      },
      onSuccess: (result) => {
        void qc.cancelQueries({ queryKey: ['chiefThreads', teamId] });
        qc.setQueryData<ChiefThread[]>(['chiefThreads', teamId], (threads) => {
          const current = threads ?? [];
          return current.some((thread) => thread.id === result.thread.id)
            ? current.map((thread) => (thread.id === result.thread.id ? result.thread : thread))
            : [...current, result.thread];
        });
        cacheUserMessage(qc, result.thread.id, result.message);
        invalidateAll();
      },
    }),
    chiefOpenChannel: useMutation({
      mutationFn: (projectId: string) =>
        api.post<ChiefThread>(`/api/teams/${teamId}/chief/channels/${projectId}`, {}),
      onSuccess: (thread) => {
        void qc.cancelQueries({ queryKey: ['chiefThreads', teamId] });
        qc.setQueryData<ChiefThread[]>(['chiefThreads', teamId], (threads) => {
          const current = threads ?? [];
          return current.some((row) => row.id === thread.id)
            ? current.map((row) => (row.id === thread.id ? thread : row))
            : [...current, thread];
        });
      },
    }),
    chiefRewind: useMutation({
      mutationFn: (input: { threadId: string; messageId: string }) =>
        api.post<{ deletedCount: number; thread: ChiefThread }>(
          `/api/teams/${teamId}/chief/threads/${input.threadId}/rewind`,
          { messageId: input.messageId },
        ),
      onSuccess: invalidateAll,
    }),
    chiefWithdraw: useMutation({
      mutationFn: (input: { threadId: string; messageId: string }) =>
        api.del<{ ok: boolean }>(
          `/api/teams/${teamId}/chief/threads/${input.threadId}/messages/${input.messageId}`,
        ),
      onSuccess: invalidateAll,
    }),
    chiefSteer: useMutation({
      mutationFn: (input: { threadId: string; messageId: string }) =>
        api.post<{ steered: boolean }>(
          `/api/teams/${teamId}/chief/threads/${input.threadId}/messages/${input.messageId}/steer`,
          {},
        ),
      onSuccess: invalidateAll,
    }),
    chiefStop: useMutation({
      mutationFn: (input: { threadId: string }) =>
        api.post<{ delegated: boolean }>(
          `/api/teams/${teamId}/chief/threads/${input.threadId}/stop`,
          {},
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
    startXaiDevice: useMutation({
      mutationFn: () =>
        api.post<XaiDeviceStartResponse>(`/api/teams/${teamId}/providers/oauth/xai/device`, {}),
    }),
    pollXaiDevice: useMutation({
      mutationFn: (state: string) =>
        api.post<XaiDevicePollResponse>(`/api/teams/${teamId}/providers/oauth/xai/device/poll`, {
          state,
        }),
      onSuccess: (result) => {
        if (result.status === 'complete') invalidateAll();
      },
    }),
    startGithubOAuth: useMutation({
      mutationFn: () =>
        api.post<OAuthAuthorizeResponse>(`/api/teams/${teamId}/github/oauth/authorize`, {}),
    }),
    disconnectGithub: useMutation({
      mutationFn: () => api.del<void>(`/api/teams/${teamId}/github/connection`),
      onSuccess: invalidateAll,
    }),
    deleteProvider: useMutation({
      mutationFn: (id: string) => api.del<void>(`/api/teams/${teamId}/providers/${id}`),
      onSuccess: invalidateAll,
    }),
    testProvider: useMutation({
      mutationFn: (id: string) =>
        api.post<ProviderTestResult>(`/api/teams/${teamId}/providers/${id}/test`, {}),
    }),
    patchProvider: useMutation({
      mutationFn: (input: { id: string; body: PatchProviderBody }) =>
        api.patch<ProviderRecord>(`/api/teams/${teamId}/providers/${input.id}`, input.body),
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
        machineAccess: boolean;
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
    decideRetroProposal: useMutation({
      mutationFn: (input: { proposalId: string; decision: 'accept' | 'dismiss' }) =>
        api.post<RetroProposal>(
          `/api/teams/${teamId}/chief/retro-proposals/${input.proposalId}/${input.decision}`,
          {},
        ),
      onSuccess: invalidateAll,
    }),
    deleteMemory: useMutation({
      mutationFn: (input: { memoryId: string }) =>
        api.del<void>(`/api/teams/${teamId}/memories/${input.memoryId}`),
      onSuccess: (_data, input) => {
        qc.setQueryData<MemoryRecord[]>(['memories', teamId], (records) =>
          records?.filter((record) => record.id !== input.memoryId),
        );
        invalidateAll();
      },
    }),
    sendSteer: useMutation({
      mutationFn: (input: {
        conversationId: string;
        content: string;
        mode?: 'queue';
        deliverAfterStop?: boolean;
        cancelQueued?: boolean;
        editQueued?: boolean;
        queuedMessageId?: string;
        clientMessageId?: string;
      }) =>
        api.post<{ conversationId?: string; message?: unknown }>(
          `/api/conversations/${input.conversationId}/messages`,
          {
            content: input.content,
            ...(input.deliverAfterStop ? { deliverAfterStop: true } : {}),
            ...(input.cancelQueued ? { cancelQueued: true } : {}),
            ...(input.editQueued ? { editQueued: true } : {}),
            ...(input.mode ? { mode: input.mode } : {}),
            ...(input.queuedMessageId ? { queuedMessageId: input.queuedMessageId } : {}),
            ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
          },
        ),
      onError: (_error, input) => {
        void qc.invalidateQueries({ queryKey: ['messages', input.conversationId] });
      },
      onSuccess: (data, input) => {
        cacheUserMessage(
          qc,
          data.conversationId ?? input.conversationId,
          data.message,
          input.queuedMessageId === undefined
            ? undefined
            : {
                conversationId: input.conversationId,
                messageId: input.queuedMessageId,
              },
        );
        void qc.invalidateQueries({ queryKey: ['messages', input.conversationId] });
        void qc.invalidateQueries({ queryKey: ['steps', input.conversationId] });
        void qc.invalidateQueries({ queryKey: ['todo'] });
        void qc.invalidateQueries({ queryKey: ['todos', teamId] });
      },
    }),
    messageThread: useMutation({
      mutationFn: (input: { todoId: string; content: string; clientMessageId?: string }) =>
        api.post<ThreadMessageResult>(`/api/todos/${input.todoId}/messages`, {
          content: input.content,
          clientMessageId: input.clientMessageId ?? crypto.randomUUID(),
        }),
      onSuccess: (result) => {
        void qc.invalidateQueries({ queryKey: ['messages'] });
        void qc.invalidateQueries({ queryKey: ['steps', result.conversationId] });
        void qc.invalidateQueries({ queryKey: ['todo'] });
        void qc.invalidateQueries({ queryKey: ['todos', teamId] });
      },
    }),
  };
}

export type ApiMutations = ReturnType<typeof useApiMutations>;
