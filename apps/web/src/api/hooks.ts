import type {
  ApiKeyRow,
  ArtifactOfAttachment,
  AskUserAnswer,
  AskUserQuestionContent,
  BrowserPasswordGrantsResponse,
  BuildChangesPlainFolderState,
  BuildRecord,
  CapabilitiesResponse,
  ChiefGetResponse,
  ChiefMemoryUsageResponse,
  ChiefThread,
  ClerkAuthConfigResponse,
  CloudConnectStartBody,
  CloudConnectStartResponse,
  CloudExternalUrlResponse,
  CloudStatusResponse,
  CodexDevicePollResponse,
  CodexDeviceStartResponse,
  ComposioApps,
  ComposioAuthorizeResponse,
  ComposioConfigured,
  ComposioConnectBody,
  ComposioKeyBody,
  ComputerRecord,
  ComputerStep,
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
  FeedbackSubmitResponse,
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
  ManagedUpdateRuntime,
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
  ServerVersionResponse,
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
  UpdateScheduleBody,
  UpdateSkillBody,
  UpstreamModelsResult,
  UserRecord,
  XaiDevicePollResponse,
  XaiDeviceStartResponse,
} from '@cairn/shared';
import {
  type BackupHealth,
  type BackupImportResult,
  type BackupRestoreResult,
  type BackupSnapshotSummary,
  backupHealthSchema,
  backupImportResultSchema,
  backupNotice,
  IN_PROGRESS_PHASES,
  isRegisteredMachine,
  NOTHING_TO_STOP,
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
import { acknowledgeTaskFailed } from '../board/task-outbox.js';
import { threadTurnInFlight } from '../chief/orchestration-inflight.js';
import { isServerUnreachable } from '../lib/error-copy.js';
import { markErrorSurfaced } from '../lib/mutation-error-report.js';
import { randomId } from '../lib/random-id.js';
import { fetchWithSession, useAuth } from './auth.js';
import { ApiError, api } from './client.js';
import { computerQueryKeys } from './computer-query-scope.js';
import {
  cacheUserMessage,
  confirmQueuedMessageRemoval,
  moveQueueToReplacement,
} from './message-cache.js';
import { keepNewerProvider, keepNewerProviders } from './provider-freshness.js';
import { resumeRefreshDelayMs } from './resume-refresh-delay.js';
import { cachedTodo, optimisticTodo } from './team-stream-cache.js';
import { keepNewerTasks, keepNewerTodo, keepNewerTodos } from './todo-freshness.js';

const CHIEF_THREADS_INFLIGHT_POLL_MS = 3000;
const BACKUP_HEALTH_POLL_MS = 5 * 60 * 1000;
const STREAM_KEPT_FRESH_MS = 60_000;
const PREFETCH_FRESH_MS = 10_000;
const COMPUTER_STEPS_REFRESH_MS = 2_000;

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

export function useSearchResults(query: string, enabled: boolean, teamId?: string) {
  const debounced = useDebouncedValue(query, 250);
  const trimmed = debounced.trim();
  const result = useQuery({
    queryKey: ['search', teamId ?? null, trimmed],
    queryFn: ({ signal }) =>
      api.get<SearchResponse>(`/api/search?q=${encodeURIComponent(trimmed)}`, signal),
    enabled: enabled && trimmed !== '',
  });
  return {
    ...result,
    settledQuery: result.data !== undefined && !result.isError ? trimmed : undefined,
  };
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
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    api.get<TodoRecord[]>(`/api/todos?teamId=${teamId}`, signal),
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
    queryFn: ({ signal }) =>
      api.get<TodoRecord[]>(`/api/todos?teamId=${teamId}&archived=1`, signal),
    enabled: enabled && teamId !== undefined,
  });

export const tasksQuery = (teamId: string | undefined) => ({
  queryKey: ['tasks', teamId],
  queryFn: async ({ signal }: { signal: AbortSignal }) =>
    tasksQuerySchema.parse(await api.get(`/api/tasks?teamId=${teamId}&sectioned=1`, signal)),
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
  queryFn: ({ signal }: { signal: AbortSignal }) => api.get<TodoRecord>(`/api/todos/${id}`, signal),
  structuralSharing: keepNewerTodo,
});

export const useTodo = (id: string | undefined, enabled: boolean) =>
  useQuery({ ...todoQuery(id), enabled: enabled && id !== undefined });

export const useBuild = (id: string | null | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['build', id],
    queryFn: ({ signal }) => api.get<BuildRecord>(`/api/builds/${id}`, signal),
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
    queryFn: ({ signal }) => api.get<StepRow[]>(`/api/builds/${buildId}/steps`, signal),
    enabled: enabled && buildId != null,
  });

const conversationMessagesQuery = (conversationId: string | null | undefined) =>
  infiniteQueryOptions({
    queryKey: ['messages', conversationId, 'pages'],
    queryFn: ({ pageParam, signal }) =>
      api.get<ConversationMessagesResponse>(
        `/api/conversations/${conversationId}/messages${
          pageParam !== null ? `?before=${encodeURIComponent(pageParam)}` : ''
        }`,
        signal,
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
    queryFn: ({ signal }) => api.get<PlanRow[]>(`/api/builds/${buildId}/plans`, signal),
    enabled: enabled && buildId != null,
  });

export const useBuildChanges = (buildId: string | null | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['changes', buildId],
    queryFn: ({ signal }) =>
      api.get<{
        files: DocumentDiffFile[];
        reported?: boolean;
        changed?: boolean;
        plainFolder?: BuildChangesPlainFolderState;
      }>(`/api/builds/${buildId}/changes`, signal),
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
    queryFn: ({ signal }) => api.get<ScheduleRecord[]>('/api/schedules', signal),
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

export function useComputerSteps(teamId: string | undefined, enabled: boolean) {
  const auth = useAuth();
  return useQuery({
    queryKey: computerQueryKeys(teamId, auth.generation).steps,
    queryFn: async () => (await api.get<{ steps: ComputerStep[] }>('/api/computers/steps')).steps,
    enabled: enabled && teamId !== undefined && !auth.gateOpen,
    refetchInterval: COMPUTER_STEPS_REFRESH_MS,
  });
}

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

export const useServerBackup = (enabled: boolean) =>
  useQuery({
    queryKey: ['server-backup'],
    queryFn: async (): Promise<BackupHealth | null> =>
      backupHealthSchema.safeParse(await api.get('/api/server/backup')).data ?? null,
    enabled,
    refetchInterval: BACKUP_HEALTH_POLL_MS,
  });

export const useBackupNotice = (enabled: boolean) =>
  useQuery({
    queryKey: ['server-backup'],
    queryFn: async (): Promise<BackupHealth | null> =>
      backupHealthSchema.safeParse(await api.get('/api/server/backup')).data ?? null,
    select: (health) => backupNotice(health, Date.now()),
    enabled,
    refetchInterval: BACKUP_HEALTH_POLL_MS,
  });

export function useBackupMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['server-backup'] });
  return {
    runNow: useMutation({
      meta: { action: '立即备份' },
      mutationFn: () =>
        api.post<{ snapshot: BackupSnapshotSummary; health: BackupHealth }>(
          '/api/server/backup/run',
        ),
      onSuccess: (data) => {
        qc.setQueryData(['server-backup'], data.health);
      },
      onSettled: invalidate,
    }),
    restore: useMutation({
      meta: { action: '恢复备份' },
      mutationFn: (snapshotId: string) =>
        api.post<BackupRestoreResult>(
          `/api/server/backup/${encodeURIComponent(snapshotId)}/restore`,
        ),
      onSettled: invalidate,
    }),
    importArchive: useMutation({
      meta: { action: '导入备份' },
      mutationFn: async (input: {
        file: File;
        onProgress?: (percent: number) => void;
      }): Promise<BackupImportResult> => {
        const uploadViaFetch = async (): Promise<BackupImportResult> => {
          const res = await fetchWithSession('/api/server/backup/import', {
            method: 'POST',
            headers: { 'content-type': 'application/gzip' },
            body: input.file,
          });
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          if (!res.ok) {
            throw new ApiError(res.status, body?.error ?? res.statusText);
          }
          return backupImportResultSchema.parse(body);
        };
        if (typeof XMLHttpRequest === 'undefined') {
          return uploadViaFetch();
        }
        const xhrResult = await new Promise<{ status: number; statusText: string; text: string }>(
          (resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/server/backup/import');
            xhr.withCredentials = true;
            xhr.setRequestHeader('content-type', 'application/gzip');
            xhr.upload.onprogress = (event) => {
              if (event.lengthComputable && event.total > 0) {
                input.onProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)));
              }
            };
            xhr.onload = () =>
              resolve({ status: xhr.status, statusText: xhr.statusText, text: xhr.responseText });
            xhr.onerror = () => reject(new Error('Network error while uploading backup archive.'));
            xhr.send(input.file);
          },
        );
        if (xhrResult.status === 401) {
          return uploadViaFetch();
        }
        const parsedBody = (() => {
          try {
            return JSON.parse(xhrResult.text) as { error?: string } | null;
          } catch {
            return null;
          }
        })();
        if (xhrResult.status < 200 || xhrResult.status >= 300) {
          throw new ApiError(
            xhrResult.status,
            parsedBody?.error ?? (xhrResult.statusText || 'Import failed.'),
          );
        }
        return backupImportResultSchema.parse(parsedBody);
      },
      onSettled: invalidate,
    }),
  };
}

export function useServerVersion(enabled: boolean) {
  return useQuery({
    queryKey: ['server-version'],
    queryFn: () => api.get<ServerVersionResponse>('/api/server/version'),
    enabled,
    refetchInterval: 60_000,
    retry: false,
  });
}

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
    meta: { action: '保存服务商顺序' },
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

export function useUpdateRuntime(teamId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    meta: { action: '更新运行时' },
    mutationFn: (runtime: ManagedUpdateRuntime) =>
      api.post<{ ok: true; machines: string[] }>(
        `/api/teams/${teamId}/providers/runtimes/${runtime}/update`,
      ),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['model-sources', teamId] });
    },
  });
}

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
    retry: false,
    refetchInterval: (query) => {
      const state = query.state.data?.tailnet?.state;
      const transient = state === 'starting' || state === 'restarting' || state === 'needs-login';
      return transient ? REMOTE_STARTING_POLL_MS : REMOTE_POLL_MS;
    },
  });

export const useClerkAuthConfig = (enabled: boolean) =>
  useQuery({
    queryKey: ['clerkAuthConfig'],
    queryFn: () => api.get<ClerkAuthConfigResponse>('/api/auth/clerk/config'),
    enabled,
    staleTime: 60_000,
  });

export function useSetTailnetAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { action: '切换局域网访问' },
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

export function useSubmitFeedback() {
  return useMutation({
    meta: { action: '发送反馈' },
    mutationFn: (input: { message: string; route?: string; errorSummary?: string }) =>
      api.post<FeedbackSubmitResponse>('/api/feedback', input),
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
    meta: { action: '开启 Tailscale 访问' },
    mutationFn: () => api.post<TailscaleAccess>('/api/remote/tailscale', {}),
    onSuccess: (access) => queryClient.setQueryData(['tailscaleAccess'], access),
  });
}

export function useApproveMachineEnrollment(teamId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { action: '批准电脑接入' },
    mutationFn: (code: string) => api.post('/api/machine/enroll/confirm', { code }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['machines', teamId] }),
  });
}

export function applyOptimisticPairDecision(
  queryClient: QueryClient,
  id: string,
): PairingRequestView[] | undefined {
  const previous = queryClient.getQueryData<PairingRequestView[]>(['pairingRequests']);
  queryClient.setQueryData<PairingRequestView[]>(['pairingRequests'], (current) =>
    current?.filter((item) => item.id !== id),
  );
  return previous;
}

export function restoreOptimisticPairDecision(
  queryClient: QueryClient,
  previous: PairingRequestView[] | undefined,
): void {
  if (previous !== undefined) {
    queryClient.setQueryData(['pairingRequests'], previous);
  }
}

export function useRemoteMutations() {
  const queryClient = useQueryClient();
  return {
    createPairingCode: useMutation({
      meta: { action: '生成配对码' },
      mutationFn: () => api.post<PairingCodeResponse>('/api/remote/pairing', {}),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pairingGrants'] }),
    }),
    revokeDevice: useMutation({
      meta: { action: '移除设备' },
      mutationFn: (id: string) => api.del<void>(`/api/remote/devices/${encodeURIComponent(id)}`),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['remoteDevices'] }),
    }),
    revokePairingCode: useMutation({
      meta: { action: '作废配对码' },
      mutationFn: (id: string) => api.del<void>(`/api/remote/pairing/${encodeURIComponent(id)}`),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pairingGrants'] }),
    }),
    decidePairRequest: useMutation({
      meta: { action: '处理配对请求' },
      mutationFn: ({ id, decision }: { id: string; decision: 'approve' | 'deny' }) =>
        api.post<void>(`/api/remote/pairing-requests/${encodeURIComponent(id)}/${decision}`, {}),
      onMutate: async ({ id }) => {
        await queryClient.cancelQueries({ queryKey: ['pairingRequests'] });
        return { previous: applyOptimisticPairDecision(queryClient, id) };
      },
      onError: (_error, _variables, context) => {
        restoreOptimisticPairDecision(queryClient, context?.previous);
      },
      onSettled: () => {
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
      meta: { action: '连接 Telegram' },
      mutationFn: (botToken: string) =>
        api.post<{ connection: ImConnectionRecord }>(`/api/teams/${teamId}/im/telegram`, {
          botToken,
        }),
      onSuccess: invalidate,
    }),
    connectSlack: useMutation({
      meta: { action: '连接 Slack' },
      mutationFn: (fields: { appToken: string; botToken: string }) =>
        api.post<{ connection: ImConnectionRecord }>(`/api/teams/${teamId}/im/slack`, fields),
      onSuccess: invalidate,
    }),
    connectImessage: useMutation({
      meta: { action: '连接 iMessage' },
      mutationFn: (machineId: string) =>
        api.post<{ connection: ImConnectionRecord }>(`/api/teams/${teamId}/im/imessage`, {
          machineId,
        }),
      onSuccess: invalidate,
    }),
    startWechatLogin: useMutation({
      meta: { action: '开始微信登录' },
      mutationFn: () => api.post<ImWechatLoginStart>(`/api/teams/${teamId}/im/wechat/login`, {}),
    }),
    deleteConnection: useMutation({
      meta: { action: '移除连接' },
      mutationFn: (id: string) =>
        api.del<void>(`/api/teams/${teamId}/im/connections/${encodeURIComponent(id)}`),
      onSuccess: invalidate,
    }),
    reconnectConnection: useMutation({
      meta: { action: '重新连接' },
      mutationFn: (id: string) =>
        api.post<{ connection: ImConnectionRecord }>(
          `/api/teams/${teamId}/im/connections/${encodeURIComponent(id)}/reconnect`,
          {},
        ),
      onSuccess: invalidate,
    }),
    decidePairing: useMutation({
      meta: { action: '处理配对请求' },
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
      meta: { action: '连接邮箱' },
      mutationFn: (body: MailAccountCreateBody) =>
        api.post<{ account: MailAccountRecord }>(base, body),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      meta: { action: '移除邮箱' },
      mutationFn: (id: string) => api.del<void>(`${base}/${encodeURIComponent(id)}`),
      onSuccess: invalidate,
    }),
    setWakeMode: useMutation({
      meta: { action: '保存邮件唤醒方式' },
      mutationFn: ({ id, wakeMode }: { id: string; wakeMode: MailWakeMode }) =>
        api.patch<{ account: MailAccountRecord }>(`${base}/${encodeURIComponent(id)}`, {
          wakeMode,
        }),
      onSuccess: invalidate,
    }),
    addRule: useMutation({
      meta: { action: '添加邮件规则' },
      mutationFn: ({ id, rule }: { id: string; rule: MailRuleCreateBody }) =>
        api.post<{ account: MailAccountRecord }>(`${base}/${encodeURIComponent(id)}/rules`, rule),
      onSuccess: invalidate,
    }),
    removeRule: useMutation({
      meta: { action: '删除邮件规则' },
      mutationFn: ({ id, ruleId }: { id: string; ruleId: string }) =>
        api.del<void>(`${base}/${encodeURIComponent(id)}/rules/${encodeURIComponent(ruleId)}`),
      onSuccess: invalidate,
    }),
    retry: useMutation({
      meta: { action: '重试邮箱连接' },
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

function withThreadUnread(
  data: NotificationsResponse | undefined,
  threadId: string,
  unread: boolean,
): NotificationsResponse {
  const ids = (data?.unreadThreadIds ?? []).filter((id) => id !== threadId);
  return { unreadThreadIds: unread ? [...ids, threadId] : ids };
}

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
    meta: { action: '保存项目' },
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
    meta: { action: '停止后台任务' },
    mutationFn: (input: { buildId: string; taskId: string }) =>
      stopIfRunning(
        api.post<{ ok: true }>(
          `/api/builds/${input.buildId}/tasks/${encodeURIComponent(input.taskId)}/stop`,
          {},
        ),
        { ok: true as const },
      ),
    onSettled: () => {
      void qc.invalidateQueries();
    },
  });
}

async function withoutServerText<T>(request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof ApiError) error.hideServerText = true;
    throw error;
  }
}

async function stopIfRunning<T>(request: Promise<T>, alreadyStopped: T): Promise<T> {
  try {
    return await withoutServerText(request);
  } catch (error) {
    if (error instanceof ApiError && error.reason === NOTHING_TO_STOP) return alreadyStopped;
    throw error;
  }
}

export function useApiMutations(teamId: string | undefined) {
  const qc = useQueryClient();
  const invalidateAll = () => {
    void qc.invalidateQueries();
  };
  return {
    patchUser: useMutation({
      meta: { action: '保存个人资料' },
      mutationFn: (body: PatchUserBody) => api.patch<UserRecord>('/api/user/me', body),
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: ['session'] });
      },
    }),
    patchTeam: useMutation({
      meta: { action: '保存团队设置' },
      mutationFn: (body: PatchTeamBody) =>
        api.patch<TeamRecord>(`/api/teams/${encodeURIComponent(teamId ?? '')}`, body),
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: ['teams'] });
      },
    }),
    createTodo: useMutation({
      meta: { action: '创建任务' },
      mutationFn: (input: { projectId: string; spec: string; machineId?: string | null }) =>
        api.post<TodoRecord>(`/api/projects/${input.projectId}/todos`, {
          title: '',
          spec: input.spec,
          ...(input.machineId != null ? { machineId: input.machineId } : {}),
        }),
      onSuccess: invalidateAll,
    }),
    retryGithubIssue: useMutation({
      meta: { action: '重试同步 GitHub issue' },
      mutationFn: (todoId: string) =>
        api.post<TodoRecord>(`/api/todos/${todoId}/github-issue/retry`, {}),
      onSuccess: invalidateAll,
    }),
    patchTodo: useMutation({
      meta: { action: '保存任务' },
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
      onError: (_error, _input, optimistic) => {
        optimistic?.rollback();
        invalidateAll();
      },
      onSuccess: (_record, _input, optimistic) => {
        optimistic?.settle();
        invalidateAll();
      },
    }),
    runTodoOn: useMutation({
      meta: { action: '切换运行电脑' },
      mutationFn: (input: { todoId: string; machineId: string }) =>
        api.post<TodoRecord>(`/api/todos/${input.todoId}/runner`, { machineId: input.machineId }),
      onSuccess: invalidateAll,
    }),
    stopAndDoneTodo: useMutation({
      meta: { action: '标记完成' },
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
      meta: { action: '归档任务' },
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
      onError: (_error, _input, optimistic) => {
        optimistic?.rollback();
        invalidateAll();
      },
    }),
    deleteTodo: useMutation({
      meta: { action: '删除任务' },
      mutationFn: (id: string) => api.del<void>(`/api/todos/${id}`),
      onSuccess: (_data, id) => {
        acknowledgeTaskFailed(id);
        invalidateAll();
      },
    }),
    setThreadRead: useMutation({
      meta: { action: '标记已读' },
      mutationFn: (input: { id: string; read: boolean }) =>
        api
          .post<NotificationRecord>(
            `/api/teams/${encodeURIComponent(teamId ?? '')}/notifications/${encodeURIComponent(input.id)}/${input.read ? 'read' : 'unread'}`,
          )
          .catch((error: unknown) => {
            if (isServerUnreachable(error)) markErrorSurfaced(error);
            throw error;
          }),
      onMutate: async (input) => {
        const queryKey = ['notifications', teamId];
        await qc.cancelQueries({ queryKey });
        const wasUnread =
          qc.getQueryData<NotificationsResponse>(queryKey)?.unreadThreadIds.includes(input.id) ??
          false;
        qc.setQueryData<NotificationsResponse>(queryKey, (data) =>
          withThreadUnread(data, input.id, !input.read),
        );
        return { wasUnread };
      },
      onSettled: (_data, error, input, optimistic) => {
        if (error && optimistic)
          qc.setQueryData<NotificationsResponse>(['notifications', teamId], (data) =>
            withThreadUnread(data, input.id, optimistic.wasUnread),
          );
        void qc.invalidateQueries({ queryKey: ['notifications', teamId] });
      },
    }),
    orchestrateTodo: useMutation({
      meta: { action: '交给 Coordinator' },
      mutationFn: (id: string) =>
        api.post<{
          thread: ChiefThread;
          message: { id: string; role: 'user'; content: string; createdAt: number };
        }>(`/api/todos/${id}/orchestrate`, {}),
      onSuccess: invalidateAll,
    }),
    stepAction: useMutation({
      meta: { action: '提交步骤操作' },
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
      meta: { action: '停止运行' },
      mutationFn: (input: { buildId: string; discard: boolean }) =>
        stopIfRunning(
          api.post<{ delegated: boolean }>(`/api/builds/${input.buildId}/stop`, {
            discard: input.discard,
          }),
          { delegated: false },
        ),
      onSettled: invalidateAll,
    }),
    retryBuildNow: useMutation({
      meta: { action: '立即重试' },
      mutationFn: (input: { buildId: string; clientMessageId?: string }) =>
        api.post<{ delegated: true; mode: 'quota_resumed' | 'restarted' }>(
          `/api/builds/${encodeURIComponent(input.buildId)}/retry-now`,
          { clientMessageId: input.clientMessageId ?? randomId() },
        ),
      onSuccess: invalidateAll,
      onError: invalidateAll,
    }),
    createSchedule: useMutation({
      meta: { action: '创建定时任务' },
      mutationFn: (body: CreateScheduleBody) =>
        api.post<ScheduleRecord & { webhookToken?: string; webhookUrl?: string }>(
          '/api/schedules',
          body,
        ),
      onSuccess: invalidateAll,
    }),
    updateSchedule: useMutation({
      meta: { action: '保存定时任务' },
      mutationFn: (input: { id: string; body: UpdateScheduleBody }) =>
        api.put<ScheduleRecord & { webhookToken?: string; webhookUrl?: string }>(
          `/api/schedules/${encodeURIComponent(input.id)}`,
          input.body,
        ),
      onSuccess: invalidateAll,
    }),
    patchSchedule: useMutation({
      meta: { action: '保存定时任务' },
      mutationFn: (input: { id: string; body: PatchScheduleBody }) =>
        api.patch<ScheduleRecord>(`/api/schedules/${input.id}`, input.body),
      onSuccess: invalidateAll,
    }),
    deleteSchedule: useMutation({
      meta: { action: '删除定时任务' },
      mutationFn: (id: string) => api.del<void>(`/api/schedules/${id}`),
      onSuccess: invalidateAll,
    }),
    runSchedule: useMutation({
      meta: { action: '运行定时任务' },
      mutationFn: (id: string) => api.post<ScheduleRecord>(`/api/schedules/${id}/run`, {}),
      onSuccess: invalidateAll,
      onError: invalidateAll,
    }),
    patchMachine: useMutation({
      meta: { action: '保存电脑设置' },
      mutationFn: (input: { id: string; body: PatchMachineBody }) =>
        api.patch<MachineRecord>(`/api/machines/${input.id}`, input.body),
      onMutate: (input) => {
        const previous = qc.getQueryData<MachineRecord[]>(['machines', teamId]);
        const previousTeams = qc.getQueryData<TeamRecord[]>(['teams']);
        qc.setQueryData<MachineRecord[]>(['machines', teamId], (rows) =>
          (rows ?? []).map((m) => {
            if (m.id !== input.id) return m;
            return { ...m, ...input.body };
          }),
        );
        if (input.body.isDefault === true) {
          qc.setQueryData<TeamRecord[]>(['teams'], (teams) =>
            teams?.map((entry, index) =>
              (teamId !== undefined ? entry.id === teamId : index === 0)
                ? { ...entry, defaultMachineId: input.id }
                : entry,
            ),
          );
        }
        return { previous, previousTeams };
      },
      onSuccess: invalidateAll,
      onError: (_error, _input, context) => {
        qc.setQueryData<MachineRecord[]>(['machines', teamId], context?.previous ?? []);
        if (context?.previousTeams !== undefined) {
          qc.setQueryData<TeamRecord[]>(['teams'], context.previousTeams);
        }
      },
    }),
    deleteMachine: useMutation({
      meta: { action: '移除电脑' },
      mutationFn: (id: string) => api.del<void>(`/api/machines/${encodeURIComponent(id)}`),
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: ['machines', teamId] });
        void qc.invalidateQueries({ queryKey: ['routing-settings', teamId] });
        void qc.invalidateQueries({ queryKey: ['model-routing', teamId] });
        void qc.invalidateQueries({ queryKey: ['teams'] });
      },
    }),
    switchChiefStepMachine: useMutation({
      meta: { action: '切换运行电脑' },
      mutationFn: (input: { stepId: string; machineId: string }) =>
        api.post<{ ok: true; machineId: string; name: string }>(
          `/api/chief/steps/${encodeURIComponent(input.stepId)}/switch-machine`,
          { machineId: input.machineId },
        ),
      onSuccess: invalidateAll,
    }),
    pairPhone: useMutation({
      meta: { action: '配对手机' },
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
      meta: { action: '重新配对手机' },
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
      meta: { action: '移除手机' },
      mutationFn: (input: { machineId: string; phoneId: string }) =>
        api.del<{ outcome: string }>(
          `/api/machines/${encodeURIComponent(input.machineId)}/phones/${encodeURIComponent(input.phoneId)}`,
        ),
      onSuccess: (_result, input) => {
        void qc.invalidateQueries({ queryKey: ['phones', input.machineId] });
      },
    }),
    handbackPhone: useMutation({
      meta: { action: '交还手机' },
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
      meta: { action: '创建项目' },
      mutationFn: (body: CreateProjectBody) =>
        api.post<ProjectRecord>('/api/projects', { ...body, ...(teamId ? { teamId } : {}) }),
      onSuccess: invalidateAll,
    }),
    patchProject: usePatchProject(teamId),
    pickLocalFolder: useMutation({
      meta: { action: '选择文件夹' },
      mutationFn: () => api.post<FsPickResult>('/api/fs/pick'),
    }),
    setProjectArchived: useMutation({
      meta: { action: '归档项目' },
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
      meta: { action: '发送消息' },
      mutationFn: (input: {
        threadId: string | null;
        content: string;
        projectId?: string | null;
        clientMessageId?: string;
        designCommentIds?: readonly string[];
        signal?: AbortSignal;
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
              input.signal,
            )
          : api.post<{ thread: ChiefThread; message: TranscriptRow }>(
              `/api/conversations/${input.threadId}/messages`,
              body,
              input.signal,
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
      meta: { action: '打开项目频道' },
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
      meta: { action: '重试问候' },
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
      meta: { action: '回到这条消息' },
      mutationFn: (input: { threadId: string; messageId: string }) =>
        api.post<{ deletedCount: number; thread: ChiefThread }>(
          `/api/teams/${teamId}/chief/threads/${input.threadId}/rewind`,
          { messageId: input.messageId },
        ),
      onSuccess: invalidateAll,
    }),
    chiefWithdraw: useMutation({
      meta: { action: '撤回消息' },
      mutationFn: (input: { threadId: string; messageId: string }) =>
        withoutServerText(
          api.del<{ ok: boolean }>(
            `/api/teams/${teamId}/chief/threads/${input.threadId}/messages/${input.messageId}`,
          ),
        ),
      onSuccess: invalidateAll,
      onError: invalidateAll,
    }),
    chiefStop: useMutation({
      meta: { action: '停止回复' },
      mutationFn: (input: { threadId: string; messageId?: string }) =>
        stopIfRunning(
          api.post<{ delegated: boolean }>(
            `/api/teams/${teamId}/chief/threads/${input.threadId}/stop`,
            { messageId: input.messageId },
          ),
          { delegated: false },
        ),
      onSettled: invalidateAll,
    }),
    chiefAnswerQuestion: useMutation({
      meta: { action: '提交回答' },
      mutationFn: (input: { threadId: string; requestId: string; answers: AskUserAnswer[] }) =>
        api.post<AskUserQuestionContent>(
          `/api/teams/${teamId}/chief/threads/${input.threadId}/questions/${input.requestId}/answer`,
          { answers: input.answers },
        ),
      onSuccess: invalidateAll,
    }),
    chiefCancelQuestion: useMutation({
      meta: { action: '取消问题' },
      mutationFn: (input: { threadId: string; requestId: string }) =>
        api.post<{ ok: boolean }>(
          `/api/teams/${teamId}/chief/threads/${input.threadId}/questions/${input.requestId}/cancel`,
          {},
        ),
      onSuccess: () => qc.invalidateQueries(),
    }),
    createProvider: useMutation({
      meta: { action: '添加服务商' },
      mutationFn: (body: CreateProviderBody) =>
        api.post<ProviderRecord>(`/api/teams/${teamId}/providers`, body),
      onSuccess: invalidateAll,
    }),
    startProviderOAuth: useMutation({
      meta: { action: '发起登录' },
      mutationFn: (presetId: string) =>
        api.post<OAuthAuthorizeResponse>(
          `/api/teams/${teamId}/providers/oauth/${presetId}/authorize`,
          {},
        ),
    }),
    startXaiDevice: useMutation({
      meta: { action: '登录 xAI' },
      mutationFn: () =>
        api.post<XaiDeviceStartResponse>(`/api/teams/${teamId}/providers/oauth/xai/device`, {}),
    }),
    pollXaiDevice: useMutation({
      meta: { action: '登录 xAI' },
      mutationFn: (state: string) =>
        api.post<XaiDevicePollResponse>(`/api/teams/${teamId}/providers/oauth/xai/device/poll`, {
          state,
        }),
      onSuccess: (result) => {
        if (result.status === 'complete') invalidateAll();
      },
    }),
    startCodexDevice: useMutation({
      meta: { action: '登录 ChatGPT 订阅' },
      mutationFn: () =>
        api.post<CodexDeviceStartResponse>(
          `/api/teams/${teamId}/providers/oauth/openai-codex/device`,
          {},
        ),
    }),
    pollCodexDevice: useMutation({
      meta: { action: '登录 ChatGPT 订阅' },
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
      meta: { action: '连接 GitHub' },
      mutationFn: () =>
        api.post<OAuthAuthorizeResponse>(`/api/teams/${teamId}/github/oauth/authorize`, {}),
    }),
    startGithubConnectionDevice: useMutation({
      meta: { action: '连接 GitHub' },
      mutationFn: () =>
        api.post<GithubConnectionDeviceStart>(`/api/teams/${teamId}/github/connection/device`, {}),
    }),
    pollGithubConnectionDevice: useMutation({
      meta: { action: '连接 GitHub' },
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
      meta: { action: '取消连接 GitHub' },
      mutationFn: (attemptId: string) =>
        api.del<void>(`/api/teams/${teamId}/github/connection/device/${attemptId}`),
    }),
    disconnectGithub: useMutation({
      meta: { action: '断开 GitHub' },
      mutationFn: () => api.del<void>(`/api/teams/${teamId}/github/connection`),
      onSuccess: invalidateAll,
    }),
    deleteProvider: useMutation({
      meta: { action: '移除服务商' },
      mutationFn: (id: string) => api.del<void>(`/api/teams/${teamId}/providers/${id}`),
      onSuccess: invalidateAll,
    }),
    testProvider: useMutation({
      meta: { action: '测试连接' },
      mutationFn: (input: { id: string; model: string }) =>
        api.post<TeamProviderTestResult>(`/api/teams/${teamId}/providers/${input.id}/test`, {
          model: input.model,
        }),
    }),
    upstreamModels: useMutation({
      meta: { action: '读取模型列表' },
      mutationFn: (id: string) =>
        api.get<UpstreamModelsResult>(`/api/teams/${teamId}/providers/${id}/upstream-models`),
    }),
    patchProvider: useMutation({
      meta: { action: '保存服务商' },
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
      meta: { action: '添加连接器' },
      mutationFn: (body: CreateMcpConnectorBody) =>
        api.post<McpConnectorRecord>(`/api/teams/${teamId}/mcp-connectors`, body),
      onSuccess: invalidateAll,
    }),
    patchMcpConnector: useMutation({
      meta: { action: '保存连接器' },
      mutationFn: (input: { id: string; body: PatchMcpConnectorBody }) =>
        api.patch<McpConnectorRecord>(
          `/api/teams/${teamId}/mcp-connectors/${input.id}`,
          input.body,
        ),
      onSuccess: invalidateAll,
    }),
    startMcpConnectorOAuth: useMutation({
      meta: { action: '发起连接器登录' },
      mutationFn: (body: StartMcpConnectorOAuthBody) =>
        api.post<{ authorizationUrl: string }>(
          `/api/teams/${teamId}/mcp-connectors/oauth/start`,
          body,
        ),
    }),
    bindGithubConnector: useMutation({
      meta: { action: '连接 GitHub' },
      mutationFn: (connectorId: string | undefined) =>
        api.post<McpConnectorRecord>(
          `/api/teams/${teamId}/mcp-connectors/github/bind`,
          connectorId === undefined ? {} : { connectorId },
        ),
      onSuccess: invalidateAll,
    }),
    startGithubDevice: useMutation({
      meta: { action: '连接 GitHub' },
      mutationFn: (connectorId: string | undefined) =>
        api.post<GithubConnectorDeviceStart>(
          `/api/teams/${teamId}/mcp-connectors/github/device`,
          connectorId === undefined ? {} : { connectorId },
        ),
    }),
    pollGithubDevice: useMutation({
      meta: { action: '连接 GitHub' },
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
      meta: { action: '取消连接 GitHub' },
      mutationFn: (attemptId: string) =>
        api.del<void>(`/api/teams/${teamId}/mcp-connectors/github/device/${attemptId}`),
    }),
    githubInstallations: useMutation({
      meta: { action: '检查 GitHub 仓库授权' },
      mutationFn: (connectorId: string) =>
        api.post<{ installed: boolean }>(
          `/api/teams/${teamId}/mcp-connectors/${connectorId}/github/installations`,
          {},
        ),
    }),
    checkMcpConnector: useMutation({
      meta: { action: '检查连接器' },
      mutationFn: (id: string) =>
        api.post<McpConnectorRecord>(`/api/teams/${teamId}/mcp-connectors/${id}/check`, {}),
      onSuccess: invalidateAll,
    }),
    deleteMcpConnector: useMutation({
      meta: { action: '移除连接器' },
      mutationFn: (id: string) => api.del<void>(`/api/teams/${teamId}/mcp-connectors/${id}`),
      onSuccess: invalidateAll,
    }),
    saveComposioKey: useMutation({
      meta: { action: '保存 Composio 密钥' },
      mutationFn: (body: ComposioKeyBody) =>
        api.put<ComposioConfigured>(`/api/teams/${teamId}/mcp-connectors/composio/key`, body),
      onSuccess: invalidateAll,
    }),
    deleteComposioKey: useMutation({
      meta: { action: '移除 Composio 密钥' },
      mutationFn: () => api.del<void>(`/api/teams/${teamId}/mcp-connectors/composio/key`),
      onSuccess: invalidateAll,
    }),
    connectComposioApp: useMutation({
      meta: { action: '连接应用' },
      mutationFn: (body: ComposioConnectBody) =>
        api.post<McpConnectorRecord>(`/api/teams/${teamId}/mcp-connectors/composio/toolkits`, body),
      onSuccess: invalidateAll,
    }),
    authorizeComposioApp: useMutation({
      meta: { action: '授权应用' },
      mutationFn: (connectorId: string) =>
        api.post<ComposioAuthorizeResponse>(
          `/api/teams/${teamId}/mcp-connectors/composio/${connectorId}/authorize`,
          {},
        ),
      onSuccess: invalidateAll,
    }),
    reconnectComposioApp: useMutation({
      meta: { action: '重新连接应用' },
      mutationFn: (connectorId: string) =>
        api.post<ComposioAuthorizeResponse>(
          `/api/teams/${teamId}/mcp-connectors/composio/${connectorId}/reconnect`,
          {},
        ),
      onSuccess: invalidateAll,
    }),
    pollComposioApp: useMutation({
      meta: { action: '检查应用连接' },
      mutationFn: (connectorId: string) =>
        api.post<McpConnectorRecord>(
          `/api/teams/${teamId}/mcp-connectors/composio/${connectorId}/poll`,
          {},
        ),
      onSuccess: invalidateAll,
    }),
    revokeComposioApp: useMutation({
      meta: { action: '断开应用' },
      mutationFn: (connectorId: string) =>
        api.post<McpConnectorRecord>(
          `/api/teams/${teamId}/mcp-connectors/composio/${connectorId}/revoke`,
          {},
        ),
      onSuccess: invalidateAll,
    }),
    createSecret: useMutation({
      meta: { action: '保存密钥' },
      mutationFn: (body: SetSecretBody) =>
        api.post<SecretRecord>(`/api/teams/${teamId}/secrets`, body),
      onSuccess: invalidateAll,
    }),
    updateSecret: useMutation({
      meta: { action: '保存密钥' },
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
      meta: { action: '删除密钥' },
      mutationFn: (id: string) => api.del<void>(`/api/teams/${teamId}/secrets/${id}`),
      onSuccess: invalidateAll,
    }),
    revokeBrowserPasswordGrant: useMutation({
      meta: { action: '撤销浏览器密码授权' },
      mutationFn: (grantId: string) =>
        api.del<void>(`/api/teams/${teamId}/browser-password-grants/${grantId}`),
      onSuccess: invalidateAll,
    }),
    answerSecretRequest: useMutation({
      meta: { action: '提交密钥' },
      mutationFn: (body: SecretRequestAnswer) =>
        api.post<SecretRequestAnswered>(`/api/teams/${teamId}/secret-requests`, body),
      onSuccess: invalidateAll,
    }),
    createApiKey: useMutation({
      meta: { action: '创建 API 密钥' },
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
      meta: { action: '删除 API 密钥' },
      mutationFn: (id: string) =>
        api.del<void>(`/api/teams/${teamId}/api-keys/${encodeURIComponent(id)}`),
      onSettled: invalidateAll,
    }),
    createSkill: useMutation({
      meta: { action: '创建技能' },
      mutationFn: (body: CreateSkillBody) =>
        api.post<SkillRecord>(`/api/skills?teamId=${teamId}`, body),
      onSuccess: invalidateAll,
    }),
    updateSkill: useMutation({
      meta: { action: '保存技能' },
      mutationFn: (input: { id: string; body: UpdateSkillBody }) =>
        api.put<SkillRecord>(
          `/api/teams/${teamId}/skills/${encodeURIComponent(input.id)}`,
          input.body,
        ),
      onSuccess: invalidateAll,
    }),
    importSkill: useMutation({
      meta: { action: '导入技能' },
      mutationFn: (body: ImportSkillBody) =>
        api.post<SkillRecord>(`/api/teams/${teamId}/skills/import`, body),
      onSuccess: invalidateAll,
    }),
    deleteMemory: useMutation({
      meta: { action: '删除记忆' },
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
      meta: { action: '保存记忆' },
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
      meta: { action: '提交记忆修改' },
      mutationFn: (body: MemoryEditBody) =>
        api.post<MemoryEditRecord>(`/api/teams/${teamId}/memory-edits`, body),
      onSuccess: (record) => {
        qc.setQueryData<MemoryEditRecord | null>(['memory-edit', teamId], record);
        invalidateAll();
      },
    }),
    stopMemoryEdit: useMutation({
      meta: { action: '停止记忆修改' },
      mutationFn: (input: { editId: string; attempt?: number }) =>
        stopIfRunning<MemoryEditRecord | null>(
          api.post<MemoryEditRecord>(
            `/api/teams/${teamId}/memory-edits/${input.editId}/stop`,
            input.attempt === undefined ? {} : { attempt: input.attempt },
          ),
          null,
        ),
      onSuccess: (record) => {
        if (record !== null)
          qc.setQueryData<MemoryEditRecord | null>(['memory-edit', teamId], record);
        invalidateAll();
      },
    }),
    importMemoryFile: useMutation({
      meta: { action: '导入记忆文件' },
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
      meta: { action: '发送消息' },
      mutationFn: (input: {
        conversationId: string;
        content: string;
        mode?: 'queue';
        deliverAfterStop?: boolean;
        cancelQueued?: boolean;
        editQueued?: boolean;
        queuedMessageId?: string;
        clientMessageId?: string;
        signal?: AbortSignal;
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
          input.signal,
        ),
      onError: (_error, input) => {
        void qc.invalidateQueries({ queryKey: ['messages', input.conversationId] });
      },
      onSuccess: (data, input) => {
        if (input.cancelQueued === true && input.queuedMessageId !== undefined)
          confirmQueuedMessageRemoval(qc, input.conversationId, input.queuedMessageId);
        else
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
      meta: { action: '发送消息' },
      mutationFn: (input: {
        todoId: string;
        content: string;
        clientMessageId?: string;
        conversationId?: string | null;
        signal?: AbortSignal;
      }) =>
        api.post<ThreadMessageResult>(
          `/api/todos/${input.todoId}/messages`,
          { content: input.content, clientMessageId: input.clientMessageId ?? randomId() },
          input.signal,
        ),
      onSuccess: (result, input) => {
        if (input.conversationId != null && result.conversationId != null)
          moveQueueToReplacement(qc, input.conversationId, result.conversationId);
        void qc.invalidateQueries({ queryKey: ['messages'] });
        void qc.invalidateQueries({ queryKey: ['steps', result.conversationId] });
        void qc.invalidateQueries({ queryKey: ['todo'] });
        void qc.invalidateQueries({ queryKey: ['todos', teamId] });
      },
    }),
    undoBuildChanges: useMutation({
      meta: { action: '撤销改动' },
      mutationFn: (buildId: string) =>
        api.post<{ delegated: true }>(`/api/builds/${encodeURIComponent(buildId)}/undo`, {}),
      onSuccess: (_data, buildId) => {
        void qc.invalidateQueries({ queryKey: ['changes', buildId] });
        void qc.invalidateQueries({ queryKey: ['steps', buildId] });
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
      meta: { action: '恢复版本' },
      mutationFn: (versionId: string) =>
        api.post<DesignVersionRecord>(
          `${designPath(todoId)}/versions/${encodeURIComponent(versionId)}/restore`,
        ),
      onSuccess: refresh,
    }),
    saveVersion: useMutation({
      meta: { action: '保存版本' },
      mutationFn: (content: string) =>
        api.post<DesignVersionRecord>(
          `${designPath(todoId)}/${encodeURIComponent(fileName)}/versions`,
          { content },
        ),
      onSuccess: refresh,
    }),
    createComment: useMutation({
      meta: { action: '添加评论' },
      mutationFn: (input: DesignCommentCreate) =>
        api.post<DesignCommentRecord>(`${designPath(todoId)}/comments`, input),
      onSuccess: (row) => {
        qc.setQueryData<DesignCommentRecord[]>(commentsKey, (rows) => [...(rows ?? []), row]);
        void refresh();
      },
    }),
    patchComment: useMutation({
      meta: { action: '保存评论' },
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
      meta: { action: '创建分享链接' },
      mutationFn: () => api.post<DesignShareRecord>(sharePath),
      onSettled: refresh,
    }),
    stopShare: useMutation({
      meta: { action: '停止分享' },
      mutationFn: () => api.del<void>(sharePath),
      onSettled: refresh,
    }),
    saveMark: useMutation({
      meta: { action: '保存标注' },
      mutationFn: (pngBase64: string) =>
        api.post<{ attachmentId: string }>(`${designPath(todoId)}/marks`, { pngBase64 }),
    }),
    deleteComment: useMutation({
      meta: { action: '删除评论' },
      mutationFn: (id: string) => api.del<void>(commentPath(id)),
      onMutate: (id) => changeComments((rows) => rows.filter((row) => row.id !== id)),
      onError: rollback,
      onSettled: refresh,
    }),
  };
}

const UNLINKED_CLOUD_STATUS: CloudStatusResponse = {
  configured: false,
  linked: false,
  cloudReachable: true,
  user: null,
  subscribed: false,
  hasBillingCustomer: false,
  subscriptionStatus: null,
  currentPeriodEnd: null,
  workspace: null,
};

const CLOUD_ACTIVE_POLL_MS = 1_500;

export async function fetchCloudStatus(): Promise<CloudStatusResponse> {
  try {
    return await api.get<CloudStatusResponse>('/api/cloud/status');
  } catch (err) {
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
      return UNLINKED_CLOUD_STATUS;
    }
    throw err;
  }
}

export function useCloudStatus(enabled: boolean, options?: { activePoll?: boolean }) {
  return useQuery({
    queryKey: ['cloudStatus'],
    queryFn: fetchCloudStatus,
    enabled,
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: options?.activePoll ? CLOUD_ACTIVE_POLL_MS : false,
  });
}

export function useCloudAccountMutations() {
  const queryClient = useQueryClient();
  return {
    startConnect: useMutation({
      meta: { action: '启动 Cairn 账号登录' },
      mutationFn: (body: CloudConnectStartBody) =>
        api.post<CloudConnectStartResponse>('/api/cloud/connect/start', body),
    }),
    startCheckout: useMutation({
      meta: { action: '打开订阅结账页面' },
      mutationFn: () => api.post<CloudExternalUrlResponse>('/api/cloud/checkout', {}),
    }),
    openBillingPortal: useMutation({
      meta: { action: '打开订阅与发票管理页' },
      mutationFn: () => api.post<CloudExternalUrlResponse>('/api/cloud/billing-portal', {}),
    }),
    disconnect: useMutation({
      meta: { action: '退出 Cairn 账号' },
      mutationFn: () => api.post<{ ok: boolean }>('/api/cloud/disconnect', {}),
      onSuccess: () => {
        queryClient.setQueryData<CloudStatusResponse>(['cloudStatus'], (prev) => ({
          ...UNLINKED_CLOUD_STATUS,
          configured: prev?.configured ?? true,
        }));
        void queryClient.invalidateQueries({ queryKey: ['cloudStatus'] });
      },
    }),
  };
}
