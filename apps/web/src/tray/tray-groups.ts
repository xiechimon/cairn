import {
  type ClaudeSubscriptionListEntry,
  type DailyUsage,
  isStalled,
  type MachineQueuedThread,
  type MachineRecord,
  type MachineRunningThread,
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

export interface TrayGroup {
  key: string;
  label: string;
  literal?: boolean;
  meta?: { parts: TrayText[]; warn: boolean; tip: TrayText };
  rows: TrayRow[];
}

export type TrayMachine = Pick<
  MachineRecord,
  'id' | 'name' | 'online' | 'running' | 'queued' | 'strain' | 'capabilities' | 'maxConcurrent'
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
      hint: { key: '{n} 分没进展', vars: { n } },
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
  capacity: '这台电脑同时在跑的已经到上限，空出位置就开始',
  quota: '额度用完了，到点自动开始',
  waiting: '等这台电脑空出来',
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

function loadText(ratio: number): TrayText {
  if (ratio >= 1) return { key: '负载满了' };
  if (ratio >= 0.6) return { key: '负载偏高' };
  return { key: '负载正常' };
}

function machineMeta(machine: TrayMachine): TrayGroup['meta'] {
  const hardware = machine.capabilities?.hardware;
  if (hardware == null) return undefined;
  const strain = machine.strain ?? [];
  const load = hardware.loadAvg5 ?? hardware.loadAvg1;
  const total = hardware.memoryTotalMb;
  const memory =
    total !== undefined && total > 0
      ? Math.round((1 - hardware.memoryAvailableMb / total) * 100)
      : null;
  const parts: TrayText[] = [
    ...(memory === null ? [] : [{ key: '内存 {memory}%', vars: { memory } }]),
    loadText(load / hardware.cpuCores),
    ...(strain.includes('disk') ? [{ key: '磁盘快满了' }] : []),
  ];
  return {
    parts,
    warn: strain.length > 0,
    tip: {
      key: '可用内存 {free} GB；5 分钟负载 {load}，{cores} 核；剩余磁盘 {disk} GB；最多同时 {slots} 个',
      vars: {
        free: (hardware.memoryAvailableMb / 1024).toFixed(1),
        load: load.toFixed(1),
        cores: hardware.cpuCores,
        disk: Math.round(hardware.diskFreeMb / 1024),
        slots: machine.maxConcurrent ?? '—',
      },
    },
  };
}

function machineGroup(machine: TrayMachine, now: number): TrayGroup | null {
  const running = (machine.running ?? []).map((thread) => runningRow(thread, now));
  const queued = (machine.queued ?? []).map(queuedRow);
  if (running.length === 0 && queued.length === 0 && (machine.strain ?? []).length === 0) {
    return null;
  }
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
    meta: machineMeta(machine),
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
    .filter((machine) => machine.online)
    .map((machine) => machineGroup(machine, now))
    .filter((group) => group !== null);
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
  return groups.filter((group) => group.rows.length > 0 || group.meta?.warn === true);
}

export interface TrayUsage {
  tokens: string;
  quota: TrayText | null;
}

export function trayUsage(
  usage: DailyUsage | undefined,
  subscriptions: readonly ClaudeSubscriptionListEntry[] | undefined,
  now: number,
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
    const used = live.flatMap((sub) => (sub.windows ?? []).map((w) => w.utilization));
    if (used.length > 0) {
      quota = {
        key: 'Claude 额度 {pct}%',
        vars: { pct: Math.round(Math.min(1, Math.max(...used)) * 100) },
      };
    }
  }
  return { tokens: formatTokens(total), quota };
}
