import {
  type AntigravitySubscriptionListEntry,
  type ClaudeSubscriptionListEntry,
  type DailyUsage,
  isRegisteredMachine,
  isStalled,
  type MachineCapabilities,
  type MachineQueuedThread,
  type MachineRecord,
  type MachineRunningThread,
  type MachineStrainReason,
  machineStrain,
  RESEARCH_BEFORE_PLAN_SOURCE_KIND,
  RESEARCH_STUCK_SOURCE_KIND,
} from '@cairn/shared';
import { glyphOf, isWaiting, type TaskEntry, type TasksView } from '../board/tasks-sections.js';
import { threadHref } from '../board/thread-copy.js';
import type { GlyphKind } from '../components/status-glyph.js';
import type { TVars } from '../i18n/translate.js';
import { formatTokens } from '../usage/usage-model.js';

export const TRAY_MAX_ROWS = 6;
export const TRAY_MACHINE_MAX_ROWS = 5;

export const TRAY_HIGH_PRESSURE = 0.6;
export const TRAY_FULL_PRESSURE = 0.9;

const PLUMBING_KINDS: ReadonlySet<string> = new Set([
  RESEARCH_BEFORE_PLAN_SOURCE_KIND,
  RESEARCH_STUCK_SOURCE_KIND,
]);

export interface TrayText {
  key: string;
  vars?: TVars;
}

export interface TrayRow {
  key: string;
  title: string;
  note?: TrayText;
  glyph: GlyphKind;
  at: number;
  path: string;
  hint?: TrayText;
  warn?: boolean;
  tip?: TrayText;
}

export type TrayMetaLevel = 'normal' | 'high' | 'full';

export interface TrayGroup {
  key: string;
  label: string;
  literal?: boolean;
  os?: Pick<MachineCapabilities, 'osPlatform' | 'osDistribution'> | null;
  meta?: { percent: number; level: TrayMetaLevel; warn: boolean; tip: TrayText };
  machine?: TrayMachineState;
  rows: TrayRow[];
}

export type TrayMachineState =
  | {
      kind: 'online';
      memory: number | null;
      cpu: number | null;
      load: number;
      cores: number;
      diskGb: number;
      strain: readonly MachineStrainReason[];
    }
  | { kind: 'unreported' }
  | { kind: 'offline'; lastSeenAt: number | null };

export type TrayMachine = Pick<
  MachineRecord,
  | 'id'
  | 'name'
  | 'kind'
  | 'online'
  | 'lastSeenAt'
  | 'running'
  | 'queued'
  | 'strain'
  | 'capabilities'
>;

function channelPath(projectId: string | null): string {
  return projectId === null ? '/app' : `/app?project=${projectId}&chat=1`;
}

function taskRow(entry: TaskEntry): TrayRow {
  return {
    key: entry.todo.id,
    title: entry.todo.title,
    glyph: glyphOf(entry),
    at: entry.todo.phaseAt,
    path: threadHref(entry.todo.id, ''),
  };
}

const newest = (a: TrayRow, b: TrayRow) => b.at - a.at;
const minutes = (ms: number) => Math.max(0, Math.floor(ms / 60_000));

export function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function runningRow(thread: MachineRunningThread, now: number): TrayRow {
  const progressAt = thread.lastProgressAt ?? thread.startedAt;
  const base = {
    key: thread.threadId,
    title: thread.title,
    at: thread.startedAt,
    path: threadHref(thread.threadId, ''),
  };
  if (isStalled(progressAt, now)) {
    const n = minutes(now - progressAt);
    return {
      ...base,
      glyph: 'attention',
      hint: { key: '{n} 分钟无进展', vars: { n } },
      warn: true,
      tip: { key: '还在运行，但 {n} 分钟没有新输出或工具结果', vars: { n } },
    };
  }
  return {
    ...base,
    glyph: 'working',
    hint: { key: '{n} 分', vars: { n: minutes(now - thread.startedAt) } },
  };
}

const QUEUED_TIP: Record<MachineQueuedThread['reason'], string> = {
  quota: '额度用完了，到点自动开始',
  waiting: '等待这台执行机空闲',
};

function queuedRow(thread: MachineQueuedThread): TrayRow {
  const hint: TrayText =
    thread.reason === 'quota'
      ? thread.retryAt === null
        ? { key: '等额度' }
        : { key: '等额度 · {at}', vars: { at: clockTime(thread.retryAt) } }
      : { key: '排队中' };
  return {
    key: thread.threadId,
    title: thread.title,
    glyph: 'queued',
    at: 0,
    path: threadHref(thread.threadId, ''),
    hint,
    tip: { key: QUEUED_TIP[thread.reason] },
  };
}

function memoryOf(machine: TrayMachine): number | null {
  const hardware = machine.capabilities?.hardware;
  if (hardware == null) return null;
  const total = hardware.memoryTotalMb;
  return (
    hardware.memoryPressure ??
    (total !== undefined && total > 0 ? 1 - hardware.memoryAvailableMb / total : null)
  );
}

function machineState(machine: TrayMachine): TrayMachineState {
  if (!machine.online) return { kind: 'offline', lastSeenAt: machine.lastSeenAt ?? null };
  const hardware = machine.capabilities?.hardware;
  if (hardware == null) return { kind: 'unreported' };
  return {
    kind: 'online',
    memory: memoryOf(machine),
    cpu: hardware.cpuUtilization ?? null,
    load: hardware.loadAvg1,
    cores: hardware.cpuCores,
    diskGb: Math.round(hardware.diskFreeMb / 1024),
    strain: machine.strain ?? machineStrain(hardware),
  };
}

function machineMeta(machine: TrayMachine): TrayGroup['meta'] {
  const hardware = machine.capabilities?.hardware;
  if (hardware == null || !machine.online) return undefined;
  const strain = machine.strain ?? [];
  const memory = memoryOf(machine);
  const cpu = hardware.cpuUtilization ?? null;
  const pressure = Math.min(1, Math.max(memory ?? 0, cpu ?? 0));
  const level: TrayMetaLevel =
    strain.length > 0 || pressure >= TRAY_FULL_PRESSURE
      ? 'full'
      : pressure >= TRAY_HIGH_PRESSURE
        ? 'high'
        : 'normal';
  const disk = Math.round(hardware.diskFreeMb / 1024);
  const mem = Math.round((memory ?? 0) * 100);
  return {
    percent: Math.round(pressure * 100),
    level,
    warn: strain.length > 0,
    tip:
      cpu === null
        ? { key: '内存压力 {mem}%；剩余磁盘 {disk} GB', vars: { mem, disk } }
        : {
            key: '内存压力 {mem}%；CPU {cpu}%；剩余磁盘 {disk} GB',
            vars: { mem, cpu: Math.round(cpu * 100), disk },
          },
  };
}

function machineGroup(machine: TrayMachine, now: number): TrayGroup {
  const running = (machine.running ?? []).map((thread) => runningRow(thread, now));
  const queued = (machine.queued ?? []).map(queuedRow);
  const all = [
    ...running.filter((row) => row.warn).sort((a, b) => a.at - b.at),
    ...running.filter((row) => !row.warn).sort((a, b) => a.at - b.at),
    ...queued,
  ];
  const rows = all.slice(0, TRAY_MACHINE_MAX_ROWS);
  if (all.length > rows.length) {
    rows.push({
      key: `${machine.id}:more`,
      title: '',
      note: { key: '还有 {n} 个，在 Cairn 里看', vars: { n: all.length - rows.length } },
      glyph: 'ring',
      at: 0,
      path: '/app',
    });
  }
  return {
    key: `machine:${machine.id}`,
    label: machine.name,
    literal: true,
    os: machine.capabilities,
    meta: machineMeta(machine),
    machine: machineState(machine),
    rows,
  };
}

export function trayGroups(
  view: TasksView,
  machines: readonly TrayMachine[] = [],
  now: number = Date.now(),
): TrayGroup[] {
  const shown = view.entries.filter((entry) => !PLUMBING_KINDS.has(entry.todo.sourceKind ?? ''));
  const waiting = [
    ...view.questions.map((question) => ({
      key: question.requestId,
      title: question.header,
      glyph: 'attention' as const,
      at: question.createdAt,
      path: channelPath(question.projectId),
    })),
    ...shown.filter((entry) => isWaiting(entry.section)).map(taskRow),
  ]
    .sort(newest)
    .slice(0, TRAY_MAX_ROWS);
  const machineGroups = machines
    .filter(isRegisteredMachine)
    .sort((a, b) => Number(b.online) - Number(a.online))
    .map((machine) => machineGroup(machine, now));
  const onMachine = new Set(
    machines.flatMap((machine) =>
      [...(machine.running ?? []), ...(machine.queued ?? [])].map((thread) => thread.threadId),
    ),
  );
  const working = shown
    .filter((entry) => entry.section === 'working' && !onMachine.has(entry.todo.id))
    .map(taskRow)
    .sort(newest)
    .slice(0, TRAY_MAX_ROWS - waiting.length);
  const groups: TrayGroup[] = [
    { key: 'waiting', label: '等你', rows: waiting },
    ...machineGroups,
    { key: 'working', label: '进行中', rows: working },
  ];
  return groups.filter((group) => group.rows.length > 0 || group.machine !== undefined);
}

export function popoverGroups(groups: readonly TrayGroup[]): TrayGroup[] {
  return groups.filter(
    (group) =>
      group.machine?.kind !== 'offline' && (group.rows.length > 0 || group.meta?.warn === true),
  );
}

export interface TrayUsage {
  tokens: string;
  quota: TrayText | null;
}

export function trayUsage(
  usage: DailyUsage | undefined,
  subscriptions: readonly ClaudeSubscriptionListEntry[] | undefined,
  now: number,
  antigravitySubscriptions?: readonly AntigravitySubscriptionListEntry[],
): TrayUsage | null {
  const today = usage?.days.at(-1);
  const total = today === undefined ? 0 : today.coordinator + today.tasks;
  if (total === 0) return null;
  const live = (subscriptions ?? []).filter((sub) => sub.enabled !== false);
  const exhausted = live.filter(
    (sub) => sub.state === 'exhausted' && (sub.cooldownUntil ?? Number.POSITIVE_INFINITY) > now,
  );
  let quota: TrayText | null = null;
  if (live.length > 0 && exhausted.length === live.length) {
    const back = Math.min(...exhausted.map((sub) => sub.cooldownUntil ?? Number.POSITIVE_INFINITY));
    quota = Number.isFinite(back)
      ? { key: 'Claude 额度用完 · {at} 恢复', vars: { at: clockTime(back) } }
      : { key: 'Claude 额度用完' };
  } else {
    const claudeUsed = live.flatMap((sub) => (sub.windows ?? []).map((w) => w.utilization));
    const agyUsed = (antigravitySubscriptions ?? [])
      .filter((sub) => sub.enabled !== false && (sub.expiresAt === null || sub.expiresAt > now))
      .flatMap((sub) => (sub.windows ?? []).map((w) => w.utilization));
    const claudeMax = claudeUsed.length > 0 ? Math.max(...claudeUsed) : null;
    const agyMax = agyUsed.length > 0 ? Math.max(...agyUsed) : null;
    if (agyMax !== null && (claudeMax === null || agyMax > claudeMax)) {
      quota = {
        key: 'Antigravity 额度 {pct}%',
        vars: { pct: Math.round(Math.min(1, agyMax) * 100) },
      };
    } else if (claudeMax !== null) {
      quota = {
        key: 'Claude 额度 {pct}%',
        vars: { pct: Math.round(Math.min(1, claudeMax) * 100) },
      };
    }
  }
  return { tokens: formatTokens(total), quota };
}
