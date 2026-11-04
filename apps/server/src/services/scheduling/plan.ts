import type {
  ScheduleCloseReason,
  ScheduleEvidence,
  ScheduleGroup,
  ScheduleItem,
  ScheduleLabelChange,
  ScheduleReport,
} from '@cairn/shared';
import { SCHEDULE_CLOSE_REASONS } from '@cairn/shared';

export const IN_PROGRESS_EXECUTOR = '已在做';

export interface ScheduleIssue {
  number: number;
  title: string;
  body: string;
  comments?: string[];
  labels: string[];
  state: string;
  createdAt: number;
  updatedAt: number;
  url: string;
}

export interface ScheduleMergedPull {
  number: number;
  title: string;
  body?: string;
  mergedAt: number;
  url: string;
}

export interface ScheduleInput {
  generatedAt: number;
  mainSha: string;
  issues: ScheduleIssue[];
  mergedPulls: ScheduleMergedPull[];
  specLedger: string[];
  inFlight: Map<number, string>;
}

export interface ParsedDependencies {
  issues: number[];
  unparsed: string[];
}

const DEP_MARKER = /(依赖|blocked[- ]by|depends on|等\s*#\d)/iu;
const NO_NUMBER = /依赖|blocked[- ]by|depends on|等待|需先|先等/iu;
const ISSUE_REF = /#(\d+)/gu;

export function parseIssueDependencies(text: string): ParsedDependencies {
  const found = new Set<number>();
  const unparsed: string[] = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    const refs = [...line.matchAll(ISSUE_REF)]
      .map((m) => Number(m[1]))
      .filter((n) => Number.isSafeInteger(n) && n > 0);
    if (refs.length > 0 && DEP_MARKER.test(line)) {
      for (const n of refs) found.add(n);
      continue;
    }
    if (NO_NUMBER.test(line)) unparsed.push(line);
  }
  return { issues: [...found].sort((a, b) => a - b), unparsed };
}

interface CloseSignal {
  reason: ScheduleCloseReason;
  evidence: ScheduleEvidence[];
}

const SUPERSEDED_PATTERNS = [
  /(?:已被|已被?新票|由)\s*#(\d+)\s*(?:取代|替代)/u,
  /superseded by\s*#(\d+)/iu,
  /replaced by\s*#(\d+)/iu,
];

const SUPERSEDED_BY_DESIGN = /被\s*(?:spec\s*\d+|ADR\s*\d+)[\s\S]{0,40}?替代/iu;

export function mergedPullNaming(number: number, pulls: ScheduleMergedPull[]): ScheduleEvidence[] {
  const evidence: ScheduleEvidence[] = [];
  for (const pull of pulls) {
    if (!namesIssue(number, pull.body ?? '')) continue;
    evidence.push({ kind: 'merged-pull', ref: `#${pull.number}`, url: pull.url });
  }
  return evidence;
}

function namesIssue(number: number, text: string): boolean {
  return new RegExp(`#${number}(?!\\d)`, 'u').test(text);
}

export function ledgerLinesNaming(number: number, ledger: string[]): ScheduleEvidence[] {
  const evidence: ScheduleEvidence[] = [];
  for (const line of ledger) {
    if (!namesIssue(number, line)) continue;
    evidence.push({ kind: 'ledger-line', ref: line.trim(), url: null });
  }
  return evidence;
}

export interface AcceptanceBoxes {
  checked: number;
  unchecked: number;
}

const CHECKBOX_LINE = /^\s*[-*+]\s+\[([ xX])\]/u;

export function acceptanceBoxes(body: string): AcceptanceBoxes {
  let checked = 0;
  let unchecked = 0;
  for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
    const match = CHECKBOX_LINE.exec(line);
    if (match === null) continue;
    if (match[1] === ' ') unchecked += 1;
    else checked += 1;
  }
  return { checked, unchecked };
}

export function supersedingEvidence(
  text: string,
  byNumber: Map<number, ScheduleIssue>,
): ScheduleEvidence[] {
  for (const pattern of SUPERSEDED_PATTERNS) {
    const match = pattern.exec(text);
    if (match === null) continue;
    const target = Number(match[1]);
    if (!Number.isSafeInteger(target) || target <= 0) continue;
    return [
      {
        kind: 'superseding-issue',
        ref: `#${target}`,
        url: byNumber.get(target)?.url ?? null,
      },
    ];
  }
  return [];
}

const DELIVERY_MARKERS =
  /(?:拆成|已由|由\s*#[\d#\s、,，]+完成|delivered by|split into|landed in)/iu;

export function handoverEvidence(target: ScheduleIssue, input: ScheduleInput): ScheduleEvidence[] {
  const byPull = new Map(input.mergedPulls.map((p) => [p.number, p]));
  const evidence: ScheduleEvidence[] = [];
  for (const comment of target.comments ?? []) {
    if (!DELIVERY_MARKERS.test(comment)) continue;
    for (const match of comment.matchAll(/#(\d+)/gu)) {
      const number = Number(match[1]);
      const pull = byPull.get(number);
      if (pull === undefined) continue;
      const already = evidence.some((e) => e.ref === `#${number}`);
      if (already) continue;
      evidence.push({ kind: 'handover', ref: `#${number}`, url: pull.url });
    }
  }
  return evidence.sort((a, b) => Number(a.ref.slice(1)) - Number(b.ref.slice(1)));
}

export function closeSignal(
  target: ScheduleIssue,
  input: ScheduleInput,
  byNumber: Map<number, ScheduleIssue>,
): CloseSignal | null {
  const boxes = acceptanceBoxes(target.body);
  const merged = mergedPullNaming(target.number, input.mergedPulls);
  if (boxes.checked === 0 || boxes.unchecked > 0 || merged.length === 0) return null;
  const text = `${target.title}\n${target.body}\n${(target.comments ?? []).join('\n')}`;
  const superseding = supersedingEvidence(text, byNumber);
  if (superseding.length > 0) return { reason: 'superseded', evidence: superseding };
  const byDesign = SUPERSEDED_BY_DESIGN.exec(text);
  if (byDesign !== null) {
    return {
      reason: 'superseded',
      evidence: [{ kind: 'ledger-line', ref: byDesign[0], url: null }],
    };
  }
  return { reason: 'done', evidence: merged };
}

const CLOSE_REASON_COPY: Record<ScheduleCloseReason, string> = {
  done: '已完成',
  superseded: '已被取代',
  outdated: '已过时',
  duplicate: '重复',
};

export function reasonFor(
  group: ScheduleGroup,
  target: ScheduleIssue,
  input: ScheduleInput,
  deps: number[],
  signal: CloseSignal | null,
  readyLabel: string,
): string {
  const boxes = acceptanceBoxes(target.body);
  const heldBack =
    signal === null && boxes.unchecked > 0 ? `（验收还差 ${boxes.unchecked} 项）` : '';
  if (signal !== null) {
    const first = signal.evidence[0];
    const proof =
      first === undefined ? '' : `${first.ref}${first.kind === 'ledger-line' ? '' : ' '}`;
    return `${CLOSE_REASON_COPY[signal.reason]}：${proof}`.trim();
  }
  if (input.inFlight.has(target.number)) {
    return `${IN_PROGRESS_EXECUTOR}：构建 ${input.inFlight.get(target.number) ?? ''} 在飞`.trim();
  }
  if (boxes.unchecked > 0) {
    const proof = mergedPullNaming(target.number, input.mergedPulls)
      .concat(ledgerLinesNaming(target.number, input.specLedger))
      .map((e) => e.ref)
      .join(' / ');
    const cited = proof === '' ? '' : `（已有 ${proof}）`;
    return `验收还差 ${boxes.unchecked} 项没勾${cited}，需人工判断，不自动关`;
  }
  if (deps.length > 0) {
    const depLine = `等依赖 ${deps.map((n) => `#${n}`).join(' / ')} 合入后才能排期`;
    const risk = labelsOf(target).has(readyLabel.toLowerCase())
      ? `；现在挂着 ${readyLabel}，轮询可能领走，建议先摘`
      : '';
    return `${depLine}${risk}${heldBack}`;
  }
  if (group === 'now') return '依赖已清，标注 ready-for-agent，可交给 agent';
  if (labelsOf(target).has(readyLabel.toLowerCase())) {
    return `现在挂着 ${readyLabel}，轮询可能领走，建议先摘${heldBack}`;
  }
  if (group === 'next') return '无在飞构建也未被标 ready，排在本轮之后';
  return `暂无解封证据，维持待办（创建于 ${new Date(target.createdAt).toISOString().slice(0, 10)}）`;
}

function labelsOf(target: ScheduleIssue): Set<string> {
  return new Set(target.labels.map((l) => l.trim().toLowerCase()));
}

export function labelChangeFor(
  group: ScheduleGroup,
  target: ScheduleIssue,
  readyLabel: string,
): ScheduleLabelChange | null {
  const has = labelsOf(target).has(readyLabel.toLowerCase());
  if (group === 'now') return has ? null : { add: [readyLabel], remove: [] };
  return has ? { add: [], remove: [readyLabel] } : null;
}

export function planSchedule(input: ScheduleInput, readyLabel = 'ready-for-agent'): ScheduleReport {
  const byNumber = new Map(input.issues.map((i) => [i.number, i]));
  const mergedNumbers = new Set(input.mergedPulls.map((p) => p.number));
  const items: ScheduleItem[] = [];
  const unparsedDeps: ScheduleReport['unparsedDeps'] = [];
  const groups: Record<ScheduleGroup, number[]> = { now: [], next: [], later: [], close: [] };

  for (const target of input.issues) {
    const parsed = parseIssueDependencies(`${target.title}\n${target.body}`);
    const deps = parsed.issues.filter((n) => byNumber.has(n) && !mergedNumbers.has(n));
    for (const text of parsed.unparsed) unparsedDeps.push({ issue: target.number, text });
    const signal = closeSignal(target, input, byNumber);
    const executor = input.inFlight.get(target.number) ?? null;
    const ready = labelsOf(target).has(readyLabel.toLowerCase());
    let group: ScheduleGroup;
    if (signal !== null) group = 'close';
    else if (executor !== null) group = 'next';
    else if (deps.length > 0) group = 'next';
    else if (ready) group = 'now';
    else group = 'next';
    groups[group].push(target.number);
    items.push({
      issue: target.number,
      title: target.title,
      group,
      reason: reasonFor(group, target, input, deps, signal, readyLabel),
      deps,
      executor: executor === null ? null : IN_PROGRESS_EXECUTOR,
      updatedAt: target.updatedAt,
      evidence:
        signal?.evidence ??
        (executor === null ? [] : [{ kind: 'in-progress', ref: executor, url: null }]),
      closeReason: signal?.reason ?? null,
      labelChange: executor === null ? labelChangeFor(group, target, readyLabel) : null,
    });
  }

  const ordered = (list: number[]) => {
    const copy = [...list];
    const unlocks = (issue: number) => items.filter((i) => i.deps.includes(issue)).length;
    copy.sort((a, b) => {
      const da = items.find((i) => i.issue === a)?.deps.length ?? 0;
      const db = items.find((i) => i.issue === b)?.deps.length ?? 0;
      if (da !== db) return da - db;
      const ua = unlocks(a);
      const ub = unlocks(b);
      if (ua !== ub) return ub - ua;
      return a - b;
    });
    return copy;
  };

  return {
    id: '',
    projectId: '',
    generatedAt: input.generatedAt,
    mainSha: input.mainSha,
    groups: {
      now: ordered(groups.now),
      next: ordered(groups.next),
      later: ordered(groups.later),
      close: ordered(groups.close),
    },
    items,
    unparsedDeps,
    decidedAt: null,
    decidedBy: null,
    appliedAt: null,
  };
}

export function isCloseReason(value: string): value is ScheduleCloseReason {
  return (SCHEDULE_CLOSE_REASONS as readonly string[]).includes(value);
}
