import type {
  ApiKeyRow,
  ArtifactOfAttachment,
  AskUserAnswer,
  AskUserQuestionContent,
  BrowserPasswordGrantsResponse,
  BuildRecord,
  CapabilitiesResponse,
  ChiefGetResponse,
  ChiefMemoryUsageResponse,
  ChiefThread,
  CodexDevicePollResponse,
  CodexDeviceStartResponse,
  ComposioApps,
  ComposioAuthorizeResponse,
  ComposioConfigured,
  ComposioConnectBody,
  ComposioKeyBody,
  ComputerManageAction,
  ComputerManageResult,
  ComputerRecord,
  ConversationMessagesResponse,
  CreateMcpConnectorBody,
  CreateProjectBody,
  CreateProviderBody,
  CreateScheduleBody,
  CreateSkillBody,
  DesignCommentCreate,
  DesignCommentPatch,
  DesignCommentRecord,
  DesignPageRecord,
  DesignShareRecord,
  DesignVersionRecord,
  DiffFileContent,
  DocumentDiffFile,
  FsListResult,
  FsPickResult,
  GithubConnectionDevicePoll,
  GithubConnectionDeviceStart,
  GithubConnectionStatus,
  GithubConnectorAvailability,
  GithubConnectorDevicePoll,
  GithubConnectorDeviceStart,
  GithubIssueEcho,
  GithubReposResponse,
  ImConnectionRecord,
  ImPairingRequestRecord,
  ImportSkillBody,
  ImWechatLoginPoll,
  ImWechatLoginStart,
  MachineRecord,
  MailAccountCreateBody,
  MailAccountRecord,
  MailRuleCreateBody,
  MailWakeMode,
  McpConnectorRecord,
  McpServerRecord,
  MemoryEditBody,
  MemoryEditRecord,
  MemoryImportBody,
  MemoryImportCandidate,
  MemoryRecord,
  ModelSourcesEnvelope,
  NotificationRecord,
  NotificationsResponse,
  OAuthAuthorizeResponse,
  PackageInstallDecisionBody,
  PairedDevice,
  PairingCodeResponse,
  PairingRequestView,
  PatchMachineBody,
  PatchMcpConnectorBody,
  PatchMemoryBody,
  PatchProjectBody,
  PatchProviderBody,
  PatchScheduleBody,
  PatchTeamBody,
  PatchUserBody,
  PhoneActivity,
  PhoneRow,
  PlanResponse as PlanRow,
  ProjectFilesResponse,
  ProjectRecord,
  ProviderPreset,
  ProviderRecord,
  PrPanelRow,
  RemoteRoutesResponse,
  RouteOverride,
  ScheduleRecord,
  SearchResponse,
  SecretListEntry,
  SecretRecord,
  SecretRequestAnswer,
  SecretRequestAnswered,
  SetSecretBody,
  SkillImportCandidatesResponse,
  SkillRecord,
  StartMcpConnectorOAuthBody,
  StepJournalRow,
  TailnetAccess,
  TailscaleAccess,
  TeamProviderTestResult,
  TeamRecord,
  ThreadMessageResult,
  TodoRecord,
  TranscriptRow,
  UpdateSkillBody,
  UpstreamModelsResult,
  UserRecord,
  XaiDevicePollResponse,
  XaiDeviceStartResponse,
} from '@cairn/shared';
import {
  backupHealthSchema,
  backupNotice,
  IN_PROGRESS_PHASES,
  isRegisteredMachine,
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
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { threadTurnInFlight } from '../chief/orchestration-inflight.js';
import { fetchWithSession, useAuth } from './auth.js';
import { ApiError, api } from './client.js';
import { computerQueryKeys } from './computer-query-scope.js';
import { cacheUserMessage, moveQueueToReplacement } from './message-cache.js';
import { keepNewerProvider, keepNewerProviders } from './provider-freshness.js';
import { resumeRefreshDelayMs } from './resume-refresh-delay.js';
import { cachedTodo, optimisticTodo } from './team-stream-cache.js';
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
  order?: string[] | null;
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

export const useSchedules = (enabled: boolean) =>
  useQuery({
    queryKey: ['schedules'],
    queryFn: () => api.get<ScheduleRecord[]>('/api/schedules'),
    enabled,
  });

export function registeredMachines(machines: MachineRecord[]): MachineRecord[] {
  return machines.filter(isRegisteredMachine);
}

export const useMachines = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['machines', teamId],
    queryFn: () => api.get<MachineRecord[]>(`/api/teams/${teamId}/machines`),
    select: registeredMachines,
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

export function usePhones(machineId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['phones', machineId],
    queryFn: async () =>
      (
        await api.get<{ phones: PhoneRow[] }>(
          `/api/machines/${encodeURIComponent(machineId ?? '')}/phones`,
        )
      ).phones,
    enabled: enabled && machineId !== undefined,
    refetchInterval: 10_000,
  });
}

export function usePhoneActivity(machineId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['phone-activity', machineId],
    queryFn: async () =>
      (
        await api.get<{ activity: PhoneActivity[] }>(
          `/api/machines/${encodeURIComponent(machineId ?? '')}/phones/activity`,
        )
      ).activity,
    enabled: enabled && machineId !== undefined,
    refetchInterval: 10_000,
  });
}

export interface PhoneHandoffRow {
  phoneId: string;
  machineId: string;
  name: string;
  requestedAt: number | null;
}

export function usePhoneHandoffs(enabled: boolean) {
  return useQuery({
    queryKey: ['phone-handoffs'],
    queryFn: async () =>
      (await api.get<{ handoffs: PhoneHandoffRow[] }>('/api/phones/handoffs')).handoffs,
    enabled,
    refetchInterval: 3_000,
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

export const useProviders = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['providers', teamId],
    queryFn: () => api.get<ProvidersEnvelope>(`/api/teams/${teamId}/providers`),
    structuralSharing: keepNewerProviders,
    enabled: enabled && teamId !== undefined,
  });

export function useSaveProviderOrder(teamId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (order: string[]) =>
      api.put<{ order: string[] }>(`/api/teams/${teamId}/provider-order`, { order }),
    onMutate: async (order) => {
      await qc.cancelQueries({ queryKey: ['providers', teamId] });
      const previous = qc.getQueryData<ProvidersEnvelope>(['providers', teamId]);
      qc.setQueryData<ProvidersEnvelope>(['providers', teamId], (envelope) =>
        envelope === undefined ? envelope : { ...envelope, order },
      );
      return { previous };
    },
    onError: (_error, _order, context) => {
      qc.setQueryData<ProvidersEnvelope>(['providers', teamId], (envelope) =>
        envelope === undefined ? envelope : { ...envelope, order: context?.previous?.order },
      );
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['providers', teamId] });
      void qc.invalidateQueries({ queryKey: ['model-sources', teamId] });
    },
  });
}

export const useMemories = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['memories', teamId],
    queryFn: () => api.get<MemoryRecord[]>(`/api/teams/${teamId}/memories`),
    enabled: enabled && teamId !== undefined,
  });

export const useCurrentMemoryEdit = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['memory-edit', teamId],
    queryFn: () => api.get<MemoryEditRecord | null>(`/api/teams/${teamId}/memory-edits/current`),
    enabled: enabled && teamId !== undefined,
    refetchInterval: (query) => (query.state.data?.status === 'working' ? 1000 : false),
  });

export const useMemoryImportCandidates = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['memory-import-candidates', teamId],
    queryFn: () =>
      api
        .get<{ candidates: MemoryImportCandidate[] }>(
          `/api/teams/${teamId}/memory-imports/candidates`,
        )
        .then((r) => r.candidates),
    enabled: enabled && teamId !== undefined,
    staleTime: 60_000,
  });

export const useChiefMemoryUsage = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['chief-memory-usage', teamId],
    queryFn: () => api.get<ChiefMemoryUsageResponse>(`/api/teams/${teamId}/chief/memory-usage`),
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

export function useGithubRepos(enabled: boolean) {
  const query = useQuery({
    queryKey: ['github-repos'],
    queryFn: () => api.get<GithubReposResponse>('/api/github/repos'),
    enabled,
    refetchOnWindowFocus: 'always',
  });
  const refetch = query.refetch;
  useEffect(() => {
    if (!enabled) return;
    const onFocus = () => void refetch();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [enabled, refetch]);
  return query;
}

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
    queryFn: () => api.get<SecretListEntry[]>(`/api/teams/${teamId}/secrets`),
    enabled: enabled && teamId !== undefined,
  });

export const useBrowserPasswordGrants = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['browserPasswordGrants', teamId],
    queryFn: () =>
      api.get<BrowserPasswordGrantsResponse>(`/api/teams/${teamId}/browser-password-grants`),
    enabled: enabled && teamId !== undefined,
  });

export const useApiKeys = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['apiKeys', teamId],
    queryFn: () => api.get<ApiKeyRow[]>(`/api/teams/${teamId}/api-keys`),
    enabled: enabled && teamId !== undefined,
  });

const REMOTE_POLL_MS = 10_000;
const REMOTE_STARTING_POLL_MS = 3_000;
const DEVICES_POLL_MS = 3_000;

export const useRemoteRoutes = (enabled: boolean) =>
  useQuery({
    queryKey: ['remoteRoutes'],
    queryFn: () => api.get<RemoteRoutesResponse>('/api/remote/routes'),
    enabled,
    refetchInterval: (query) => {
      const state = query.state.data?.tailnet.state;
      const transient = state === 'starting' || state === 'restarting' || state === 'needs-login';
      return transient ? REMOTE_STARTING_POLL_MS : REMOTE_POLL_MS;
    },
  });

export function useSetTailnetAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => api.post<TailnetAccess>('/api/remote/tailnet', { enabled }),
    onMutate: (enabled) => {
      const previous = queryClient.getQueryData<RemoteRoutesResponse>(['remoteRoutes']);
      queryClient.setQueryData<RemoteRoutesResponse>(['remoteRoutes'], (old) =>
        old === undefined
          ? old
          : {
              ...old,
              tailnet: {
                enabled,
                state: enabled ? 'starting' : 'off',
                dnsName: null,
                ips: [],
                authUrl: null,
                error: null,
              },
            },
      );
      return { previous };
    },
    onError: (_error, _enabled, context) => {
      if (context?.previous !== undefined)
        queryClient.setQueryData(['remoteRoutes'], context.previous);
    },
    onSuccess: (tailnet) => {
      queryClient.setQueryData<RemoteRoutesResponse>(['remoteRoutes'], (old) =>
        old === undefined ? old : { ...old, tailnet },
      );
    },
  });
}

export const useRemoteDevices = (enabled: boolean) =>
  useQuery({
    queryKey: ['remoteDevices'],
    queryFn: () => api.get<PairedDevice[]>('/api/remote/devices'),
    enabled,
    retry: false,
    refetchInterval: DEVICES_POLL_MS,
  });

const TAILSCALE_READY_POLL_MS = 30_000;
const TAILSCALE_SETUP_POLL_MS = 3_000;

export const useTailscaleAccess = (enabled: boolean) =>
  useQuery({
    queryKey: ['tailscaleAccess'],
    queryFn: () => api.get<TailscaleAccess>('/api/remote/tailscale'),
    enabled,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.state === 'ready' ? TAILSCALE_READY_POLL_MS : TAILSCALE_SETUP_POLL_MS,
  });

export function useEnableTailscaleAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<TailscaleAccess>('/api/remote/tailscale', {}),
    onSuccess: (access) => queryClient.setQueryData(['tailscaleAccess'], access),
  });
}

export function useApproveMachineEnrollment(teamId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => api.post('/api/machine/enroll/confirm', { code }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['machines', teamId] }),
  });
}

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
    decidePairRequest: useMutation({
      mutationFn: ({ id, decision }: { id: string; decision: 'approve' | 'deny' }) =>
        api.post<void>(`/api/remote/pairing-requests/${encodeURIComponent(id)}/${decision}`, {}),
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: ['pairingRequests'] });
        void queryClient.invalidateQueries({ queryKey: ['remoteDevices'] });
      },
    }),
  };
}

export const usePairingRequests = (enabled: boolean) =>
  useQuery({
    queryKey: ['pairingRequests'],
    queryFn: () => api.get<PairingRequestView[]>('/api/remote/pairing-requests'),
    enabled,
    retry: false,
    refetchInterval: DEVICES_POLL_MS,
  });

export const usePairingGrants = (enabled: boolean) =>
  useQuery({
    queryKey: ['pairingGrants'],
    queryFn: () =>
      api.get<Array<{ id: string; expiresAt: number; createdAt: number }>>('/api/remote/pairing'),
    enabled,
    refetchInterval: DEVICES_POLL_MS,
  });

const IM_POLL_MS = 5_000;

export const useImConnections = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['imConnections', teamId],
    queryFn: () =>
      api.get<{ connections: ImConnectionRecord[] }>(`/api/teams/${teamId}/im/connections`),
    enabled: enabled && teamId !== undefined,
    refetchInterval: IM_POLL_MS,
  });

export const useImPairingRequests = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['imPairingRequests', teamId],
    queryFn: () =>
      api.get<{ requests: ImPairingRequestRecord[] }>(`/api/teams/${teamId}/im/pairing-requests`),
    enabled: enabled && teamId !== undefined,
    refetchInterval: IM_POLL_MS,
  });

const IM_WECHAT_LOGIN_POLL_MS = 2_000;

export const useImWechatLoginPoll = (
  teamId: string | undefined,
  loginId: string | null,
  enabled: boolean,
) =>
  useQuery({
    queryKey: ['imWechatLogin', teamId, loginId],
    queryFn: () =>
      api.get<ImWechatLoginPoll>(
        `/api/teams/${teamId}/im/wechat/login/${encodeURIComponent(loginId ?? '')}`,
      ),
    enabled: enabled && teamId !== undefined && loginId !== null,
    refetchInterval: IM_WECHAT_LOGIN_POLL_MS,
    retry: false,
  });

export function useImMutations(teamId: string | undefined) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['imConnections', teamId] });
    void queryClient.invalidateQueries({ queryKey: ['imPairingRequests', teamId] });
  };
  return {
    connectTelegram: useMutation({
      mutationFn: (botToken: string) =>
        api.post<{ connection: ImConnectionRecord }>(`/api/teams/${teamId}/im/telegram`, {
          botToken,
        }),
      onSuccess: invalidate,
    }),
    connectSlack: useMutation({
      mutationFn: (fields: { appToken: string; botToken: string }) =>
        api.post<{ connection: ImConnectionRecord }>(`/api/teams/${teamId}/im/slack`, fields),
      onSuccess: invalidate,
    }),
    connectImessage: useMutation({
      mutationFn: (machineId: string) =>
        api.post<{ connection: ImConnectionRecord }>(`/api/teams/${teamId}/im/imessage`, {
          machineId,
        }),
      onSuccess: invalidate,
    }),
    startWechatLogin: useMutation({
      mutationFn: () => api.post<ImWechatLoginStart>(`/api/teams/${teamId}/im/wechat/login`, {}),
    }),
    deleteConnection: useMutation({
      mutationFn: (id: string) =>
        api.del<void>(`/api/teams/${teamId}/im/connections/${encodeURIComponent(id)}`),
      onSuccess: invalidate,
    }),
    reconnectConnection: useMutation({
      mutationFn: (id: string) =>
        api.post<{ connection: ImConnectionRecord }>(
          `/api/teams/${teamId}/im/connections/${encodeURIComponent(id)}/reconnect`,
          {},
        ),
      onSuccess: invalidate,
    }),
    decidePairing: useMutation({
      mutationFn: ({ id, decision }: { id: string; decision: 'approved' | 'rejected' }) =>
        api.post<{ request: ImPairingRequestRecord }>(
          `/api/teams/${teamId}/im/pairing-requests/${encodeURIComponent(id)}/${
            decision === 'approved' ? 'approve' : 'reject'
          }`,
          {},
        ),
      onSuccess: invalidate,
    }),
  };
}

const MAIL_POLL_MS = 5_000;

export const useMailAccounts = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['mailAccounts', teamId],
    queryFn: () => api.get<{ accounts: MailAccountRecord[] }>(`/api/teams/${teamId}/mail/accounts`),
    enabled: enabled && teamId !== undefined,
    refetchInterval: MAIL_POLL_MS,
  });

export function useMailMutations(teamId: string | undefined) {
  const queryClient = useQueryClient();
  const base = `/api/teams/${teamId}/mail/accounts`;
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['mailAccounts', teamId] });
  };
  return {
    connect: useMutation({
      mutationFn: (body: MailAccountCreateBody) =>
        api.post<{ account: MailAccountRecord }>(base, body),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.del<void>(`${base}/${encodeURIComponent(id)}`),
      onSuccess: invalidate,
    }),
    setWakeMode: useMutation({
      mutationFn: ({ id, wakeMode }: { id: string; wakeMode: MailWakeMode }) =>
        api.patch<{ account: MailAccountRecord }>(`${base}/${encodeURIComponent(id)}`, {
          wakeMode,
        }),
      onSuccess: invalidate,
    }),
    addRule: useMutation({
      mutationFn: ({ id, rule }: { id: string; rule: MailRuleCreateBody }) =>
        api.post<{ account: MailAccountRecord }>(`${base}/${encodeURIComponent(id)}/rules`, rule),
      onSuccess: invalidate,
    }),
    removeRule: useMutation({
      mutationFn: ({ id, ruleId }: { id: string; ruleId: string }) =>
        api.del<void>(`${base}/${encodeURIComponent(id)}/rules/${encodeURIComponent(ruleId)}`),
      onSuccess: invalidate,
    }),
    retry: useMutation({
      mutationFn: (id: string) =>
        api.post<{ ok: true }>(`${base}/${encodeURIComponent(id)}/retry`, {}),
      onSuccess: invalidate,
    }),
  };
}

export const useMcpServers = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['mcpServers', teamId],
    queryFn: () => api.get<McpServerRecord[]>(`/api/teams/${teamId}/mcp-servers`),
    enabled: enabled && teamId !== undefined,
  });

export const useMcpConnectors = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['mcpConnectors', teamId],
    queryFn: () => api.get<McpConnectorRecord[]>(`/api/teams/${teamId}/mcp-connectors`),
    enabled: enabled && teamId !== undefined,
  });

export const useGithubConnector = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['githubConnector', teamId],
    queryFn: () =>
      api.get<GithubConnectorAvailability>(`/api/teams/${teamId}/mcp-connectors/github`),
    enabled: enabled && teamId !== undefined,
  });

export const useComposioApps = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['composioApps', teamId],
    queryFn: () => api.get<ComposioApps>(`/api/teams/${teamId}/mcp-connectors/composio`),
    enabled: enabled && teamId !== undefined,
  });

export const useSkills = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['skills', teamId],
    queryFn: () => api.get<SkillRecord[]>(`/api/skills?teamId=${teamId}`),
    enabled: enabled && teamId !== undefined,
  });

export const useSkillImportCandidates = (teamId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['skillImportCandidates', teamId],
    queryFn: () =>
      api.get<SkillImportCandidatesResponse>(`/api/teams/${teamId}/skills/import-candidates`),
    enabled: enabled && teamId !== undefined,
    retry: false,
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

export function useStopBackgroundTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { buildId: string; taskId: string }) =>
      api.post<{ ok: true }>(
        `/api/builds/${input.buildId}/tasks/${encodeURIComponent(input.taskId)}/stop`,
        {},
      ),
    onSettled: () => {
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
      onMutate: (input) =>
        optimisticTodo(qc, teamId ?? '', input.id, {
          ...(input.body.title === undefined ? {} : { title: input.body.title }),
          ...(input.body.spec === undefined ? {} : { spec: input.body.spec }),
          ...(input.body.projectId === undefined ? {} : { projectId: input.body.projectId }),
          ...(input.body.orderIndex === undefined ? {} : { orderIndex: input.body.orderIndex }),
        }),
      onError: (_error, _input, optimistic) => optimistic?.rollback(),
      onSuccess: (_record, _input, optimistic) => {
        optimistic?.settle();
        invalidateAll();
      },
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
      onMutate: (id) => {
        const phase = cachedTodo(qc, teamId ?? '', id)?.phase;
        if (phase === undefined || (IN_PROGRESS_PHASES as readonly string[]).includes(phase))
          return undefined;
        return optimisticTodo(qc, teamId ?? '', id, {
          phase: 'done',
          phaseAt: Date.now(),
          section: 'resolved',
        });
      },
      onSuccess: (_result, _id, optimistic) => {
        optimistic?.settle();
        invalidateAll();
      },
      onError: (_error, _id, optimistic) => {
        optimistic?.rollback();
        invalidateAll();
      },
    }),
    setTodoArchived: useMutation({
      mutationFn: (input: { id: string; archived: boolean }) =>
        api.post<TodoRecord>(`/api/todos/${input.id}/${input.archived ? 'archive' : 'unarchive'}`),
      onMutate: (input) =>
        optimisticTodo(qc, teamId ?? '', input.id, {
          archivedAt: input.archived ? Date.now() : null,
        }),
      onSuccess: (record, _input, optimistic) => {
        optimistic?.settle();
        qc.setQueryData(['todo', record.id], record);
        qc.setQueryData<TodoRecord[]>(['todos', teamId], (records) =>
          records?.map((row) => (row.id === record.id ? record : row)),
        );
        invalidateAll();
      },
      onError: (_error, _input, optimistic) => optimistic?.rollback(),
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
          | { action: 'restart'; feedback: string; clientMessageId: string };
      }) => api.post<{ delegated: true }>(`/api/builds/${input.buildId}/steps`, input.body),
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
    retryBuildNow: useMutation({
      mutationFn: (input: { buildId: string; clientMessageId?: string }) =>
        api.post<{ delegated: true; mode: 'quota_resumed' | 'restarted' }>(
          `/api/builds/${encodeURIComponent(input.buildId)}/retry-now`,
          { clientMessageId: input.clientMessageId ?? crypto.randomUUID() },
        ),
      onSuccess: invalidateAll,
      onError: invalidateAll,
    }),
    createSchedule: useMutation({
      mutationFn: (body: CreateScheduleBody) =>
        api.post<ScheduleRecord & { webhookToken?: string; webhookUrl?: string }>(
          '/api/schedules',
          body,
        ),
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
            return { ...m, ...input.body };
          }),
        );
        return { previous };
      },
      onSuccess: invalidateAll,
      onError: (_error, _input, context) => {
        qc.setQueryData<MachineRecord[]>(['machines', teamId], context?.previous ?? []);
      },
    }),
    deleteMachine: useMutation({
      mutationFn: (id: string) => api.del<void>(`/api/machines/${encodeURIComponent(id)}`),
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: ['machines', teamId] });
        void qc.invalidateQueries({ queryKey: ['routing-settings', teamId] });
        void qc.invalidateQueries({ queryKey: ['model-routing', teamId] });
      },
    }),
    pairPhone: useMutation({
      mutationFn: (input: {
        machineId: string;
        body:
          | { deviceId: string; name?: string; consent: true }
          | { endpoint: string; code: string; name?: string; consent: true };
      }) =>
        api.post<{ phone: PhoneRow }>(
          `/api/machines/${encodeURIComponent(input.machineId)}/phones`,
          input.body,
        ),
      onSuccess: (_result, input) => {
        void qc.invalidateQueries({ queryKey: ['phones', input.machineId] });
      },
    }),
    retryPairPhone: useMutation({
      mutationFn: (input: {
        machineId: string;
        phoneId: string;
        body: { endpoint: string; code: string; consent: true };
      }) =>
        api.post<{ phone: PhoneRow }>(
          `/api/machines/${encodeURIComponent(input.machineId)}/phones/${encodeURIComponent(input.phoneId)}/pair`,
          input.body,
        ),
      onSuccess: (_result, input) => {
        void qc.invalidateQueries({ queryKey: ['phones', input.machineId] });
      },
    }),
    forgetPhone: useMutation({
      mutationFn: (input: { machineId: string; phoneId: string }) =>
        api.del<{ outcome: string }>(
          `/api/machines/${encodeURIComponent(input.machineId)}/phones/${encodeURIComponent(input.phoneId)}`,
        ),
      onSuccess: (_result, input) => {
        void qc.invalidateQueries({ queryKey: ['phones', input.machineId] });
        void qc.invalidateQueries({ queryKey: ['phone-activity', input.machineId] });
      },
    }),
    handbackPhone: useMutation({
      mutationFn: (input: { machineId: string; phoneId: string }) =>
        api.post<{ ok: boolean }>(
          `/api/machines/${encodeURIComponent(input.machineId)}/phones/${encodeURIComponent(input.phoneId)}/handback`,
          {},
        ),
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: ['phone-handoffs'] });
      },
    }),
    createProject: useMutation({
      mutationFn: (body: CreateProjectBody) =>
        api.post<ProjectRecord>('/api/projects', { ...body, ...(teamId ? { teamId } : {}) }),
      onSuccess: invalidateAll,
    }),
    patchProject: usePatchProject(teamId),
    pickLocalFolder: useMutation({
      mutationFn: () => api.post<FsPickResult>('/api/fs/pick'),
    }),
    setProjectArchived: useMutation({
      mutationFn: (input: { id: string; archived: boolean }) =>
        api.post<ProjectRecord>(
          `/api/projects/${input.id}/${input.archived ? 'archive' : 'unarchive'}`,
        ),
      onMutate: async (input) => {
        await qc.cancelQueries({ queryKey: ['projects', teamId] });
        const previous = qc.getQueryData<ProjectRecord[]>(['projects', teamId]);
        const archivedAt = input.archived ? Date.now() : null;
        qc.setQueryData<ProjectRecord[]>(['projects', teamId], (records) =>
          records?.map((record) => (record.id === input.id ? { ...record, archivedAt } : record)),
        );
        return { previous };
      },
      onSuccess: (record) => {
        qc.setQueryData<ProjectRecord[]>(['projects', teamId], (records) =>
          records?.map((row) => (row.id === record.id ? record : row)),
        );
        invalidateAll();
      },
      onError: (_error, _input, context) => {
        qc.setQueryData(['projects', teamId], context?.previous);
      },
    }),
    chiefSend: useMutation({
      mutationFn: (input: {
        threadId: string | null;
        content: string;
        projectId?: string | null;
        clientMessageId?: string;
        designCommentIds?: readonly string[];
      }) => {
        const body = {
          content: input.content,
          ...(input.projectId != null ? { projectId: input.projectId } : {}),
          ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
          ...(input.designCommentIds !== undefined && input.designCommentIds.length > 0
            ? { designCommentIds: input.designCommentIds }
            : {}),
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
        const threadsKey = ['chiefThreads', teamId];
        if (!qc.getQueryData<ChiefThread[]>(threadsKey)?.some((t) => t.id === result.thread.id)) {
          void qc.cancelQueries({ queryKey: threadsKey });
          qc.setQueryData<ChiefThread[]>(threadsKey, (threads) => [
            ...(threads ?? []),
            result.thread,
          ]);
        }
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
    chiefRetryGreeting: useMutation({
      mutationFn: (input: { threadId: string; stepId: string }) =>
        api.post<ChiefThread>(
          `/api/teams/${teamId}/chief/threads/${input.threadId}/retry-greeting/${input.stepId}`,
          {},
        ),
      onSuccess: (thread) => {
        void qc.cancelQueries({ queryKey: ['chiefThreads', teamId] });
        qc.setQueryData<ChiefThread[]>(['chiefThreads', teamId], (threads) =>
          threads?.map((row) => (row.id === thread.id ? thread : row)),
        );
        invalidateAll();
      },
      onError: invalidateAll,
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
    startCodexDevice: useMutation({
      mutationFn: () =>
        api.post<CodexDeviceStartResponse>(
          `/api/teams/${teamId}/providers/oauth/openai-codex/device`,
          {},
        ),
    }),
    pollCodexDevice: useMutation({
      mutationFn: (state: string) =>
        api.post<CodexDevicePollResponse>(
          `/api/teams/${teamId}/providers/oauth/openai-codex/device/poll`,
          { state },
        ),
      onSuccess: (result) => {
        if (result.status === 'complete') invalidateAll();
      },
    }),
    startGithubOAuth: useMutation({
      mutationFn: () =>
        api.post<OAuthAuthorizeResponse>(`/api/teams/${teamId}/github/oauth/authorize`, {}),
    }),
    startGithubConnectionDevice: useMutation({
      mutationFn: () =>
        api.post<GithubConnectionDeviceStart>(`/api/teams/${teamId}/github/connection/device`, {}),
    }),
    pollGithubConnectionDevice: useMutation({
      mutationFn: (attemptId: string) =>
        api.post<GithubConnectionDevicePoll>(
          `/api/teams/${teamId}/github/connection/device/${attemptId}`,
          {},
        ),
      onSuccess: (result) => {
        if (result.status === 'complete') invalidateAll();
      },
    }),
    cancelGithubConnectionDevice: useMutation({
      mutationFn: (attemptId: string) =>
        api.del<void>(`/api/teams/${teamId}/github/connection/device/${attemptId}`),
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
      mutationFn: (input: { id: string; model: string }) =>
        api.post<TeamProviderTestResult>(`/api/teams/${teamId}/providers/${input.id}/test`, {
          model: input.model,
        }),
    }),
    upstreamModels: useMutation({
      mutationFn: (id: string) =>
        api.get<UpstreamModelsResult>(`/api/teams/${teamId}/providers/${id}/upstream-models`),
    }),
    patchProvider: useMutation({
      mutationFn: (input: { id: string; body: PatchProviderBody }) =>
        api.patch<ProviderRecord>(`/api/teams/${teamId}/providers/${input.id}`, input.body),
      onSuccess: (record) => {
        qc.setQueryData<ProvidersEnvelope>(['providers', teamId], (envelope) =>
          envelope === undefined
            ? envelope
            : {
                ...envelope,
                providers: envelope.providers.map((provider) =>
                  provider.id === record.id ? keepNewerProvider(provider, record) : provider,
                ),
              },
        );
        invalidateAll();
      },
    }),
    createMcpConnector: useMutation({
      mutationFn: (body: CreateMcpConnectorBody) =>
        api.post<McpConnectorRecord>(`/api/teams/${teamId}/mcp-connectors`, body),
      onSuccess: invalidateAll,
    }),
    patchMcpConnector: useMutation({
      mutationFn: (input: { id: string; body: PatchMcpConnectorBody }) =>
        api.patch<McpConnectorRecord>(
          `/api/teams/${teamId}/mcp-connectors/${input.id}`,
          input.body,
        ),
      onSuccess: invalidateAll,
    }),
    startMcpConnectorOAuth: useMutation({
      mutationFn: (body: StartMcpConnectorOAuthBody) =>
        api.post<{ authorizationUrl: string }>(
          `/api/teams/${teamId}/mcp-connectors/oauth/start`,
          body,
        ),
    }),
    bindGithubConnector: useMutation({
      mutationFn: (connectorId: string | undefined) =>
        api.post<McpConnectorRecord>(
          `/api/teams/${teamId}/mcp-connectors/github/bind`,
          connectorId === undefined ? {} : { connectorId },
        ),
      onSuccess: invalidateAll,
    }),
    startGithubDevice: useMutation({
      mutationFn: (connectorId: string | undefined) =>
        api.post<GithubConnectorDeviceStart>(
          `/api/teams/${teamId}/mcp-connectors/github/device`,
          connectorId === undefined ? {} : { connectorId },
        ),
    }),
    pollGithubDevice: useMutation({
      mutationFn: (attemptId: string) =>
        api.post<GithubConnectorDevicePoll>(
          `/api/teams/${teamId}/mcp-connectors/github/device/${attemptId}`,
          {},
        ),
      onSuccess: (result) => {
        if (result.status === 'complete') invalidateAll();
      },
    }),
    cancelGithubDevice: useMutation({
      mutationFn: (attemptId: string) =>
        api.del<void>(`/api/teams/${teamId}/mcp-connectors/github/device/${attemptId}`),
    }),
    githubInstallations: useMutation({
      mutationFn: (connectorId: string) =>
        api.post<{ installed: boolean }>(
          `/api/teams/${teamId}/mcp-connectors/${connectorId}/github/installations`,
          {},
        ),
    }),
    checkMcpConnector: useMutation({
      mutationFn: (id: string) =>
        api.post<McpConnectorRecord>(`/api/teams/${teamId}/mcp-connectors/${id}/check`, {}),
      onSuccess: invalidateAll,
    }),
    deleteMcpConnector: useMutation({
      mutationFn: (id: string) => api.del<void>(`/api/teams/${teamId}/mcp-connectors/${id}`),
      onSuccess: invalidateAll,
    }),
    saveComposioKey: useMutation({
      mutationFn: (body: ComposioKeyBody) =>
        api.put<ComposioConfigured>(`/api/teams/${teamId}/mcp-connectors/composio/key`, body),
      onSuccess: invalidateAll,
    }),
    deleteComposioKey: useMutation({
      mutationFn: () => api.del<void>(`/api/teams/${teamId}/mcp-connectors/composio/key`),
      onSuccess: invalidateAll,
    }),
    connectComposioApp: useMutation({
      mutationFn: (body: ComposioConnectBody) =>
        api.post<McpConnectorRecord>(`/api/teams/${teamId}/mcp-connectors/composio/toolkits`, body),
      onSuccess: invalidateAll,
    }),
    authorizeComposioApp: useMutation({
      mutationFn: (connectorId: string) =>
        api.post<ComposioAuthorizeResponse>(
          `/api/teams/${teamId}/mcp-connectors/composio/${connectorId}/authorize`,
          {},
        ),
      onSuccess: invalidateAll,
    }),
    reconnectComposioApp: useMutation({
      mutationFn: (connectorId: string) =>
        api.post<ComposioAuthorizeResponse>(
          `/api/teams/${teamId}/mcp-connectors/composio/${connectorId}/reconnect`,
          {},
        ),
      onSuccess: invalidateAll,
    }),
    pollComposioApp: useMutation({
      mutationFn: (connectorId: string) =>
        api.post<McpConnectorRecord>(
          `/api/teams/${teamId}/mcp-connectors/composio/${connectorId}/poll`,
          {},
        ),
      onSuccess: invalidateAll,
    }),
    revokeComposioApp: useMutation({
      mutationFn: (connectorId: string) =>
        api.post<McpConnectorRecord>(
          `/api/teams/${teamId}/mcp-connectors/composio/${connectorId}/revoke`,
          {},
        ),
      onSuccess: invalidateAll,
    }),
    createSecret: useMutation({
      mutationFn: (body: SetSecretBody) =>
        api.post<SecretRecord>(`/api/teams/${teamId}/secrets`, body),
      onSuccess: invalidateAll,
    }),
    updateSecret: useMutation({
      mutationFn: (input: {
        id: string;
        body: {
          name?: string;
          description?: string | null;
          value?: string;
          username?: string;
          kind?: 'secret' | 'pair';
        };
      }) => api.patch<SecretRecord>(`/api/teams/${teamId}/secrets/${input.id}`, input.body),
      onSuccess: invalidateAll,
    }),
    deleteSecret: useMutation({
      mutationFn: (id: string) => api.del<void>(`/api/teams/${teamId}/secrets/${id}`),
      onSuccess: invalidateAll,
    }),
    revokeBrowserPasswordGrant: useMutation({
      mutationFn: (grantId: string) =>
        api.del<void>(`/api/teams/${teamId}/browser-password-grants/${grantId}`),
      onSuccess: invalidateAll,
    }),
    answerSecretRequest: useMutation({
      mutationFn: (body: SecretRequestAnswer) =>
        api.post<SecretRequestAnswered>(`/api/teams/${teamId}/secret-requests`, body),
      onSuccess: invalidateAll,
    }),
    decidePackageInstall: useMutation({
      mutationFn: (body: PackageInstallDecisionBody) =>
        api.post<{ ok: true }>('/api/computers/package-install', body),
    }),
    manageComputer: useMutation({
      mutationFn: (input: { computerId: string; action: ComputerManageAction }) =>
        api.post<ComputerManageResult>(`/api/computers/${input.computerId}/actions`, {
          action: input.action,
        }),
      onSettled: invalidateAll,
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
    deleteApiKey: useMutation({
      mutationFn: (id: string) =>
        api.del<void>(`/api/teams/${teamId}/api-keys/${encodeURIComponent(id)}`),
      onSettled: invalidateAll,
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
    updateMemory: useMutation({
      mutationFn: (input: { memoryId: string; body: PatchMemoryBody }) =>
        api.patch<MemoryRecord>(`/api/teams/${teamId}/memories/${input.memoryId}`, input.body),
      onSuccess: (record, input) => {
        qc.setQueryData<MemoryRecord[]>(['memories', teamId], (records) =>
          records?.map((existing) => (existing.id === input.memoryId ? record : existing)),
        );
        invalidateAll();
      },
    }),
    submitMemoryEdit: useMutation({
      mutationFn: (body: MemoryEditBody) =>
        api.post<MemoryEditRecord>(`/api/teams/${teamId}/memory-edits`, body),
      onSuccess: (record) => {
        qc.setQueryData<MemoryEditRecord | null>(['memory-edit', teamId], record);
        invalidateAll();
      },
    }),
    stopMemoryEdit: useMutation({
      mutationFn: (input: { editId: string; attempt?: number }) =>
        api.post<MemoryEditRecord>(
          `/api/teams/${teamId}/memory-edits/${input.editId}/stop`,
          input.attempt === undefined ? {} : { attempt: input.attempt },
        ),
      onSuccess: (record) => {
        qc.setQueryData<MemoryEditRecord | null>(['memory-edit', teamId], record);
        invalidateAll();
      },
    }),
    importMemoryFile: useMutation({
      mutationFn: (body: MemoryImportBody) =>
        api.post<{ result: unknown }>(`/api/teams/${teamId}/memory-imports`, body),
      onSuccess: (_data, body) => {
        qc.setQueryData<MemoryImportCandidate[]>(
          ['memory-import-candidates', teamId],
          (candidates) =>
            candidates?.map((c) =>
              c.projectId === body.projectId && c.file === body.file ? { ...c, imported: true } : c,
            ),
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
        cacheUserMessage(qc, data.conversationId ?? input.conversationId, data.message, {
          conversationId: input.conversationId,
          messageId: input.queuedMessageId,
        });
        void qc.invalidateQueries({ queryKey: ['messages', input.conversationId] });
        void qc.invalidateQueries({ queryKey: ['steps', input.conversationId] });
        void qc.invalidateQueries({ queryKey: ['todo'] });
        void qc.invalidateQueries({ queryKey: ['todos', teamId] });
      },
    }),
    messageThread: useMutation({
      mutationFn: (input: {
        todoId: string;
        content: string;
        clientMessageId?: string;
        conversationId?: string | null;
      }) =>
        api.post<ThreadMessageResult>(`/api/todos/${input.todoId}/messages`, {
          content: input.content,
          clientMessageId: input.clientMessageId ?? crypto.randomUUID(),
        }),
      onSuccess: (result, input) => {
        if (input.conversationId != null && result.conversationId != null)
          moveQueueToReplacement(qc, input.conversationId, result.conversationId);
        void qc.invalidateQueries({ queryKey: ['messages'] });
        void qc.invalidateQueries({ queryKey: ['steps', result.conversationId] });
        void qc.invalidateQueries({ queryKey: ['todo'] });
        void qc.invalidateQueries({ queryKey: ['todos', teamId] });
      },
    }),
  };
}

export type ApiMutations = ReturnType<typeof useApiMutations>;

export interface DesignPagesResponse {
  pages: DesignPageRecord[];
  shareOrigin: string | null;
}

const designKey = (todoId: string) => ['design', todoId] as const;
const designPath = (todoId: string) => `/api/todos/${encodeURIComponent(todoId)}/design`;

export const designPagesQuery = (todoId: string) => ({
  queryKey: designKey(todoId),
  queryFn: () => api.get<DesignPagesResponse>(designPath(todoId)),
});

export const designVersionsQuery = (todoId: string, fileName: string | null) => ({
  queryKey: [...designKey(todoId), 'versions', fileName],
  queryFn: () =>
    api.get<DesignVersionRecord[]>(
      `${designPath(todoId)}/${encodeURIComponent(fileName ?? '')}/versions`,
    ),
});

export const artifactOfQuery = (attachmentId: string) => ({
  queryKey: ['artifact-of', attachmentId] as const,
  queryFn: async (): Promise<ArtifactOfAttachment | null> => {
    try {
      return await api.get<ArtifactOfAttachment>(
        `/api/attachments/${encodeURIComponent(attachmentId)}/artifact`,
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },
  staleTime: 30_000,
});

export const useArtifactOf = (attachmentId: string, enabled: boolean) =>
  useQuery({ ...artifactOfQuery(attachmentId), enabled });

export const useDesignPages = (todoId: string, enabled: boolean) =>
  useQuery({ ...designPagesQuery(todoId), enabled });

export const useDesignVersions = (todoId: string, fileName: string | null, enabled: boolean) =>
  useQuery({ ...designVersionsQuery(todoId, fileName), enabled: enabled && fileName !== null });

export const useDesignPageHtml = (versionId: string | null) =>
  useQuery({
    queryKey: ['design-page', versionId],
    enabled: versionId !== null,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    queryFn: async () => {
      const res = await fetchWithSession(
        `/api/design/versions/${encodeURIComponent(versionId ?? '')}/page`,
      );
      if (!res.ok) throw new ApiError(res.status, res.statusText);
      return res.text();
    },
  });

const designCommentsKey = (todoId: string, fileName: string) =>
  [...designKey(todoId), 'comments', fileName] as const;

export const useDesignComments = (todoId: string, fileName: string | null, enabled: boolean) =>
  useQuery({
    queryKey: designCommentsKey(todoId, fileName ?? ''),
    queryFn: () =>
      api.get<DesignCommentRecord[]>(
        `${designPath(todoId)}/${encodeURIComponent(fileName ?? '')}/comments`,
      ),
    enabled: enabled && fileName !== null,
  });

export function useDesignMutations(todoId: string, fileName: string) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: designKey(todoId) });
  const commentsKey = designCommentsKey(todoId, fileName);
  const changeComments = async (change: (rows: DesignCommentRecord[]) => DesignCommentRecord[]) => {
    await qc.cancelQueries({ queryKey: commentsKey });
    const previous = qc.getQueryData<DesignCommentRecord[]>(commentsKey);
    if (previous !== undefined) qc.setQueryData(commentsKey, change(previous));
    return { previous };
  };
  const rollback = (
    _error: unknown,
    _input: unknown,
    context: { previous: DesignCommentRecord[] | undefined } | undefined,
  ) => {
    if (context?.previous !== undefined) qc.setQueryData(commentsKey, context.previous);
  };
  const sharePath = `${designPath(todoId)}/${encodeURIComponent(fileName)}/share`;
  const commentPath = (commentId: string) =>
    `${designPath(todoId)}/comments/${encodeURIComponent(commentId)}`;
  return {
    restore: useMutation({
      mutationFn: (versionId: string) =>
        api.post<DesignVersionRecord>(
          `${designPath(todoId)}/versions/${encodeURIComponent(versionId)}/restore`,
        ),
      onSuccess: refresh,
    }),
    saveVersion: useMutation({
      mutationFn: (content: string) =>
        api.post<DesignVersionRecord>(
          `${designPath(todoId)}/${encodeURIComponent(fileName)}/versions`,
          { content },
        ),
      onSuccess: refresh,
    }),
    createComment: useMutation({
      mutationFn: (input: DesignCommentCreate) =>
        api.post<DesignCommentRecord>(`${designPath(todoId)}/comments`, input),
      onSuccess: (row) => {
        qc.setQueryData<DesignCommentRecord[]>(commentsKey, (rows) => [...(rows ?? []), row]);
        void refresh();
      },
    }),
    patchComment: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: DesignCommentPatch }) =>
        api.patch<DesignCommentRecord>(commentPath(id), patch),
      onMutate: ({ id, patch }) =>
        changeComments((rows) =>
          rows.map((row) =>
            row.id === id
              ? {
                  ...row,
                  ...(patch.note !== undefined ? { note: patch.note } : {}),
                  ...(patch.status !== undefined ? { status: patch.status } : {}),
                }
              : row,
          ),
        ),
      onError: rollback,
      onSettled: refresh,
    }),
    createShare: useMutation({
      mutationFn: () => api.post<DesignShareRecord>(sharePath),
      onSettled: refresh,
    }),
    stopShare: useMutation({
      mutationFn: () => api.del<void>(sharePath),
      onSettled: refresh,
    }),
    saveMark: useMutation({
      mutationFn: (pngBase64: string) =>
        api.post<{ attachmentId: string }>(`${designPath(todoId)}/marks`, { pngBase64 }),
    }),
    deleteComment: useMutation({
      mutationFn: (id: string) => api.del<void>(commentPath(id)),
      onMutate: (id) => changeComments((rows) => rows.filter((row) => row.id !== id)),
      onError: rollback,
      onSettled: refresh,
    }),
  };
}
