import {
  type ChiefThread,
  type ClaudeSubscriptionListEntry,
  type DailyUsage,
  isRegisteredMachine,
  isStalled,
  type MachineRecord,
  RESEARCH_BEFORE_PLAN_SOURCE_KIND,
  RESEARCH_STUCK_SOURCE_KIND,
  type TasksQuery,
  type TeamRecord,
  tasksQuerySchema,
  type UserRecord,
} from '@cairn/shared';

export type TrayTaskStatus =
  | { kind: 'running' | 'stalled'; minutes: number }
  | { kind: 'waiting-for-runner' }
  | { kind: 'quota'; retryAt: number | null };

type TrayRow = { path: string } & ({ title: string; status?: TrayTaskStatus } | { more: number });

export interface TrayPressure {
  percent: number;
  level: 'normal' | 'high' | 'full';
  memory: number;
  cpu: number | null;
  disk: number;
}

export interface TrayGroup {
  label:
    | { kind: 'waiting' | 'working' }
    | { kind: 'machine'; name: string; pressure: TrayPressure | null };
  rows: TrayRow[];
}

export interface TrayUsage {
  tokens: number;
  quota: { state: 'used'; percent: number } | { state: 'exhausted'; retryAt: number | null } | null;
}

export interface TrayWorkspace {
  status: 'ready';
  displayName: string;
  coordinatorBusy: boolean;
  groups: TrayGroup[];
  usage: TrayUsage | null;
}

export type TrayData = TrayWorkspace | { status: 'loading' | 'unavailable' };

const MAX_TASKS = 6;
const MAX_MACHINE_TASKS = 5;
const minutes = (ms: number) => Math.max(0, Math.floor(ms / 60_000));
const taskPath = (id: string) => `/app?${new URLSearchParams({ thread: id })}`;

function machinePressure(machine: MachineRecord): TrayPressure | null {
  const hardware = machine.capabilities?.hardware;
  if (hardware == null) return null;
  const total = hardware.memoryTotalMb;
  const memory =
    hardware.memoryPressure ??
    (total !== undefined && total > 0 ? 1 - hardware.memoryAvailableMb / total : 0);
  const cpu = hardware.cpuUtilization ?? null;
  const pressure = Math.min(1, Math.max(memory, cpu ?? 0));
  return {
    percent: Math.round(pressure * 100),
    level:
      (machine.strain?.length ?? 0) > 0 || pressure >= 0.9
        ? 'full'
        : pressure >= 0.6
          ? 'high'
          : 'normal',
    memory: Math.round(memory * 100),
    cpu: cpu === null ? null : Math.round(cpu * 100),
    disk: Math.round(hardware.diskFreeMb / 1024),
  };
}

function machineGroup(machine: MachineRecord, now: number): TrayGroup | null {
  const running = (machine.running ?? []).map((thread) => {
    const progressAt = thread.lastProgressAt ?? thread.startedAt;
    const stalled = isStalled(progressAt, now);
    return {
      at: thread.startedAt,
      title: thread.title,
      path: taskPath(thread.threadId),
      status: {
        kind: stalled ? 'stalled' : 'running',
        minutes: minutes(now - (stalled ? progressAt : thread.startedAt)),
      } as const,
    };
  });
  const queued = (machine.queued ?? []).map((thread) => ({
    title: thread.title,
    path: taskPath(thread.threadId),
    status:
      thread.reason === 'quota'
        ? { kind: 'quota' as const, retryAt: thread.retryAt }
        : { kind: 'waiting-for-runner' as const },
  }));
  const pressure = machinePressure(machine);
  if (
    running.length === 0 &&
    queued.length === 0 &&
    ((machine.strain?.length ?? 0) === 0 || pressure === null)
  )
    return null;
  const all = [
    ...running
      .sort(
        (a, b) =>
          Number(b.status.kind === 'stalled') - Number(a.status.kind === 'stalled') || a.at - b.at,
      )
      .map(({ title, path, status }) => ({ title, path, status })),
    ...queued,
  ];
  const rows: TrayRow[] = all.slice(0, MAX_MACHINE_TASKS);
  if (all.length > rows.length) rows.push({ more: all.length - rows.length, path: '/app' });
  return { label: { kind: 'machine', name: machine.name, pressure }, rows };
}

export function trayGroups(
  tasks: TasksQuery,
  machines: readonly MachineRecord[],
  now: number,
): TrayGroup[] {
  const shown = tasks.entries.filter(
    (entry) =>
      entry.kind === 'question' ||
      (entry.sourceKind !== RESEARCH_BEFORE_PLAN_SOURCE_KIND &&
        entry.sourceKind !== RESEARCH_STUCK_SOURCE_KIND),
  );
  const waiting = shown
    .flatMap((entry) => {
      if (entry.kind === 'question') {
        const path =
          entry.projectId === null
            ? '/app'
            : `/app?${new URLSearchParams({ project: entry.projectId, chat: '1' })}`;
        return [{ title: entry.title, path, at: entry.createdAt }];
      }
      if (entry.section === 'ready_for_review' || entry.section === 'needs_input') {
        return [{ title: entry.title, path: taskPath(entry.id), at: entry.phaseAt }];
      }
      return [];
    })
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_TASKS)
    .map(({ title, path }) => ({ title, path }));
  const registered = machines.filter(isRegisteredMachine);
  const machineGroups = registered
    .filter((machine) => machine.online)
    .map((machine) => machineGroup(machine, now))
    .filter((group) => group !== null);
  const onMachine = new Set(
    registered.flatMap((machine) =>
      [...(machine.running ?? []), ...(machine.queued ?? [])].map((thread) => thread.threadId),
    ),
  );
  const working = shown
    .filter((entry) => entry.kind === 'todo')
    .filter((entry) => entry.section === 'working' && !onMachine.has(entry.id))
    .sort((a, b) => b.phaseAt - a.phaseAt)
    .slice(0, MAX_TASKS - waiting.length)
    .map((entry) => ({ title: entry.title, path: taskPath(entry.id) }));
  return [
    ...(waiting.length > 0 ? [{ label: { kind: 'waiting' as const }, rows: waiting }] : []),
    ...machineGroups,
    ...(working.length > 0 ? [{ label: { kind: 'working' as const }, rows: working }] : []),
  ];
}

function tokensToday(usage: DailyUsage | undefined): number {
  const today = usage?.days.at(-1);
  return today === undefined ? 0 : today.coordinator + today.tasks;
}

export function trayUsage(
  usage: DailyUsage,
  subscriptions: readonly ClaudeSubscriptionListEntry[],
  now: number,
): TrayUsage | null {
  const tokens = tokensToday(usage);
  if (tokens === 0) return null;
  const live = subscriptions.filter((sub) => sub.enabled !== false);
  const exhausted = live.filter(
    (sub) => sub.state === 'exhausted' && (sub.cooldownUntil ?? Infinity) > now,
  );
  if (live.length > 0 && exhausted.length === live.length) {
    const retryAt = Math.min(...exhausted.map((sub) => sub.cooldownUntil ?? Infinity));
    return {
      tokens,
      quota: { state: 'exhausted', retryAt: Number.isFinite(retryAt) ? retryAt : null },
    };
  }
  const used = live.flatMap((sub) => (sub.windows ?? []).map((window) => window.utilization));
  return {
    tokens,
    quota:
      used.length === 0
        ? null
        : { state: 'used', percent: Math.round(Math.min(1, Math.max(...used)) * 100) },
  };
}

interface TeamSnapshot {
  tasks?: TasksQuery;
  machines?: MachineRecord[];
  dailyUsage?: DailyUsage;
  subscriptions?: ClaudeSubscriptionListEntry[];
  threads?: ChiefThread[];
}

function keepLast<T>(result: PromiseSettledResult<T>, last: T): T {
  return result.status === 'fulfilled' ? result.value : last;
}

export function createTrayDataLoader(origin: string, token: string) {
  let teamId: string | undefined;
  let displayName = '';
  let feeds: TeamSnapshot = {};
  let last: TrayData = { status: 'unavailable' };
  return async (claimQuotaRefresh: () => boolean): Promise<TrayData> => {
    try {
      last = await load(claimQuotaRefresh);
    } catch {
      return last;
    }
    return last;
  };

  async function load(claimQuotaRefresh: () => boolean): Promise<TrayData> {
    const signal = AbortSignal.timeout(5_000);
    const read = async <T>(path: string, method = 'GET'): Promise<T> => {
      const response = await fetch(new URL(path, origin), {
        method,
        headers: { authorization: `Bearer ${token}` },
        redirect: 'error',
        signal,
      });
      if (!response.ok) throw new Error(`Workspace status request failed (${response.status})`);
      return response.json() as Promise<T>;
    };
    const [user, teams] = await Promise.all([
      read<UserRecord>('/api/user/me').catch(() => null),
      read<TeamRecord[]>('/api/teams'),
    ]);
    displayName = user?.displayName ?? displayName;
    const nextTeam = teams[0]?.id;
    if (nextTeam !== teamId) {
      teamId = nextTeam;
      feeds = {};
      last = { status: 'unavailable' };
    }
    if (nextTeam === undefined) {
      return { status: 'ready', displayName, coordinatorBusy: false, groups: [], usage: null };
    }
    const base = `/api/teams/${encodeURIComponent(nextTeam)}`;
    const results = await Promise.allSettled([
      read<unknown>(`/api/tasks?${new URLSearchParams({ teamId: nextTeam, sectioned: '1' })}`).then(
        (response) => tasksQuerySchema.parse(response),
      ),
      read<MachineRecord[]>(`${base}/machines`),
      read<DailyUsage>(
        `${base}/usage/daily?${new URLSearchParams({ days: '1', tz: Intl.DateTimeFormat().resolvedOptions().timeZone })}`,
      ),
      read<ClaudeSubscriptionListEntry[]>(`${base}/claude-subscriptions`),
      read<ChiefThread[]>(`${base}/chief/threads`),
    ]);
    if (results.every((result) => result.status === 'rejected')) return last;
    const [tasks, machines, dailyUsage, subscriptions, threads] = results;
    feeds = {
      tasks: keepLast(tasks, feeds.tasks),
      machines: keepLast(machines, feeds.machines),
      dailyUsage: keepLast(dailyUsage, feeds.dailyUsage),
      subscriptions: keepLast(subscriptions, feeds.subscriptions),
      threads: keepLast(threads, feeds.threads),
    };
    if (
      tokensToday(feeds.dailyUsage) > 0 &&
      subscriptions.status === 'fulfilled' &&
      subscriptions.value.some((sub) => sub.enabled !== false) &&
      !signal.aborted &&
      claimQuotaRefresh()
    ) {
      feeds.subscriptions = await read<ClaudeSubscriptionListEntry[]>(
        `${base}/claude-subscriptions/quota`,
        'POST',
      ).catch(() => feeds.subscriptions);
    }
    const now = Date.now();
    return {
      status: 'ready',
      displayName,
      coordinatorBusy: (feeds.threads ?? []).some(
        (thread) => thread.turnQueue != null || thread.activeRun != null,
      ),
      groups: trayGroups(feeds.tasks ?? { entries: [] }, feeds.machines ?? [], now),
      usage:
        feeds.dailyUsage === undefined
          ? null
          : trayUsage(feeds.dailyUsage, feeds.subscriptions ?? [], now),
    };
  }
}
