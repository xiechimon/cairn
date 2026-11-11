import type { ChiefContent, ChiefStreamItem } from '../fixtures/records.js';

export type MarkPoint = readonly [number, number];
type MarkLine = readonly MarkPoint[];
type Segment = (t: number) => MarkPoint;

export type StatusMarkId =
  | 'idle'
  | 'think'
  | 'write'
  | 'look'
  | 'run'
  | 'task'
  | 'ask'
  | 'done'
  | 'error'
  | 'offline';

export interface StatusMarkView {
  id: StatusMarkId;
  label: string;
  announce: boolean;
}

export const STATUS_MARK_LABELS: Record<StatusMarkId, string> = {
  idle: '',
  think: '正在思考',
  write: '正在回复',
  look: '正在查看项目',
  run: '正在运行命令',
  task: '正在创建任务',
  ask: '等你确认',
  done: '已完成',
  error: '出错了',
  offline: '等待电脑上线',
};

export const STATUS_MARK_IDS = Object.keys(STATUS_MARK_LABELS) as StatusMarkId[];

export const MARK_VIEWBOX = '-44 -44 88 88';
export const MARK_ERASE_MS = 250;
export const MARK_DRAW_MS = 350;
export const MARK_DONE_MS = 2200;
export const PILL_FADE_MS = 160;
export const PILL_HOLD_MS = 4000;
export const ANNOUNCE_SETTLE_MS = 600;

const CONNECTION_LOST_LABEL = '连接断开，正在重连…';
const OUTAGE_LABEL = '等待恢复';
const MACHINE_OFFLINE_KEYS = new Set([
  '排队中：等 {machine} 上线（前面 {ahead} 个）',
  '排队中：等机器上线（前面 {ahead} 个）',
]);
const RESPONDING_KEY = '模型输出中...';

const RUN_TOOL = /bash|shell|exec|command|terminal/i;
const TASK_TOOLS = new Set([
  'create_todo',
  'open_thread',
  'message_thread',
  'schedule_todo',
  'schedule_create',
]);
const TASK_TOOL = /dispatch|todowrite|create_task|^task$/i;
const LOOK_TOOLS = new Set([
  'projects',
  'todos',
  'threads',
  'models',
  'machines',
  'skills',
  'docs',
  'issues',
  'pull_requests',
  'github_overlap',
  'workflow_runs',
  'conversation',
  'memories',
  'needs_you',
  'usage',
  'get_schedule',
  'wakes',
  'browser_snapshot',
]);
const LOOK_TOOL = /read|grep|glob|search|list|fetch|view/i;

export function toolMarkState(tool: string): StatusMarkId {
  if (RUN_TOOL.test(tool)) return 'run';
  if (TASK_TOOLS.has(tool) || TASK_TOOL.test(tool)) return 'task';
  if (LOOK_TOOLS.has(tool) || LOOK_TOOL.test(tool)) return 'look';
  return 'think';
}

export type LastTurn = 'reply' | 'error' | 'stopped' | null;

export function lastTurnOf(stream: readonly ChiefStreamItem[]): LastTurn {
  const last = stream.findLast(
    (item) =>
      item.kind === 'user' ||
      item.kind === 'robot' ||
      item.kind === 'error' ||
      item.kind === 'stopped',
  );
  if (last?.kind === 'robot') return last.typing === true ? null : 'reply';
  if (last?.kind === 'error') return 'error';
  if (last?.kind === 'stopped') return 'stopped';
  return null;
}

export interface StatusMarkInput {
  chief: Pick<ChiefContent, 'running' | 'runningTool' | 'stream' | 'outage'>;
  questionPending: boolean;
  connected: boolean;
}

function view(id: StatusMarkId, label = STATUS_MARK_LABELS[id], announce = true): StatusMarkView {
  return { id, label, announce };
}

export function statusMarkView({
  chief,
  questionPending,
  connected,
}: StatusMarkInput): StatusMarkView {
  if (questionPending) return view('ask');
  if (!connected) return view('offline', CONNECTION_LOST_LABEL, false);
  if (chief.outage != null) return view('offline', OUTAGE_LABEL, false);
  const stream = chief.stream ?? [];
  if (chief.running !== true) return view(lastTurnOf(stream) === 'error' ? 'error' : 'idle');
  const live = stream.findLast((item) => item.kind === 'streaming' || item.kind === 'robot');
  const liveTool =
    live?.kind === 'streaming' || live?.kind === 'robot'
      ? live.tools?.findLast((row) => row.running === true)?.label
      : undefined;
  const tool = chief.runningTool ?? liveTool;
  if (tool != null) return view(toolMarkState(tool));
  if (live?.kind === 'streaming' && MACHINE_OFFLINE_KEYS.has(live.label)) return view('offline');
  if (live?.kind === 'robot' && live.typing === true) return view('write');
  if (live?.kind === 'streaming' && live.label === RESPONDING_KEY) return view('write');
  return view('think');
}

const ACTIVE: ReadonlySet<StatusMarkId> = new Set(['think', 'write', 'look', 'run', 'task']);

export function isActiveMark(id: StatusMarkId): boolean {
  return ACTIVE.has(id);
}

export function finishedTurn(sawActive: boolean, next: StatusMarkId, lastTurn: LastTurn): boolean {
  return sawActive && next === 'idle' && lastTurn === 'reply';
}

function lineSeg(from: MarkPoint, to: MarkPoint): Segment {
  return (t) => [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
}

function quad(from: MarkPoint, control: MarkPoint, to: MarkPoint): Segment {
  return (t) => {
    const u = 1 - t;
    return [
      u * u * from[0] + 2 * u * t * control[0] + t * t * to[0],
      u * u * from[1] + 2 * u * t * control[1] + t * t * to[1],
    ];
  };
}

function arc(from: MarkPoint, to: MarkPoint, radius: number): Segment {
  const halfX = (from[0] - to[0]) / 2;
  const halfY = (from[1] - to[1]) / 2;
  const half = halfX * halfX + halfY * halfY;
  const r = Math.max(radius, Math.sqrt(half));
  const coef = Math.sqrt(Math.max(0, (r * r - half) / half));
  const cx = coef * halfY + (from[0] + to[0]) / 2;
  const cy = -coef * halfX + (from[1] + to[1]) / 2;
  const start = Math.atan2(halfY + coef * halfX, halfX - coef * halfY);
  const end = Math.atan2(-halfY + coef * halfX, -halfX - coef * halfY);
  let delta = end - start;
  if (delta < 0) delta += Math.PI * 2;
  return (t) => [cx + r * Math.cos(start + delta * t), cy + r * Math.sin(start + delta * t)];
}

function pick<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) throw new RangeError(`index ${index} is outside the list`);
  return value;
}

const FLATTEN_STEPS = 64;

export function resample(segments: readonly Segment[], count: number): MarkPoint[] {
  const dense: MarkPoint[] = [];
  for (const segment of segments) {
    for (let i = 0; i <= FLATTEN_STEPS; i++) dense.push(segment(i / FLATTEN_STEPS));
  }
  const cumulative = [0];
  for (let i = 1; i < dense.length; i++) {
    const a = pick(dense, i - 1);
    const b = pick(dense, i);
    cumulative.push(pick(cumulative, i - 1) + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = pick(cumulative, cumulative.length - 1);
  const points: MarkPoint[] = [];
  let index = 1;
  for (let n = 0; n < count; n++) {
    const target = (total * n) / (count - 1);
    while (index < dense.length - 1 && pick(cumulative, index) < target) index++;
    const a = pick(dense, index - 1);
    const b = pick(dense, index);
    const before = pick(cumulative, index - 1);
    const span = pick(cumulative, index) - before;
    const f = span === 0 ? 0 : Math.min(1, Math.max(0, (target - before) / span));
    points.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return points;
}

function polyline(points: readonly MarkPoint[]): Segment[] {
  return points.slice(1).map((to, i) => lineSeg(pick(points, i), to));
}

function range(n: number, f: (u: number) => MarkPoint): MarkPoint[] {
  return Array.from({ length: n }, (_, i) => f(i / (n - 1)));
}

const TAU = Math.PI * 2;

function wobble(points: readonly MarkPoint[], seed: number, amp: number): MarkPoint[] {
  return points.map(
    ([x, y], i): MarkPoint => [
      x + amp * Math.sin(i * 0.23 + seed),
      y + amp * Math.cos(i * 0.19 + seed * 1.7),
    ],
  );
}

function stroke(x0: number, x1: number, y: number, seed: number): MarkPoint[] {
  return wobble(
    range(26, (u) => {
      const x = x0 + (x1 - x0) * u;
      return [x, y + 0.07 * x];
    }),
    seed,
    1.3,
  );
}

function box(x: number, y: number, w: number, seed: number): MarkPoint[] {
  const corners: MarkPoint[] = [
    [x, y + 1],
    [x + w + 1, y - 1],
    [x + w, y + w + 1],
    [x - 1, y + w],
    [x + 1, y - 2],
  ];
  return wobble(resample(polyline(corners), 30), seed, 0.8);
}

const SPIRAL = resample(
  [
    arc([-4, 0], [4, 0], 4),
    arc([4, 0], [-34, 0], 19),
    arc([-34, 0], [34, 0], 34),
    arc([34, 0], [19.648, 34.648], 49),
  ],
  100,
).map(([x, y]): MarkPoint => [x * 0.72, y * 0.72 - 2]);

const CHECK = resample(
  [quad([-26, 1], [-19, 4], [-9, 20]), quad([-9, 20], [4, -6], [30, -22])],
  40,
);

const BUBBLE = resample(
  [
    quad([-20, 20], [-31, 14], [-30, -2]),
    quad([-30, -2], [-29, -25], [0, -26]),
    quad([0, -26], [30, -25], [30, -3]),
    quad([30, -3], [30, 19], [2, 20]),
    quad([2, 20], [-6, 20], [-12, 22]),
    quad([-12, 22], [-18, 29], [-28, 30]),
    quad([-28, 30], [-21, 25], [-20, 20]),
  ],
  90,
);

const CROSS = [
  resample([quad([-19, -21], [-2, -3], [20, 19])], 20),
  resample([quad([21, -20], [3, -1], [-20, 21])], 20),
];

const READ = [stroke(-25, 23, -13, 1), stroke(-26, 13, -1, 4), stroke(-24, 25, 11, 7)];

const HEIGHTS = [17, 9, 18, 8, 12];

const CURSIVE = wobble(
  range(150, (u) => {
    const th = u * TAU * 5;
    const h = pick(HEIGHTS, Math.min(4, Math.floor(u * 5)));
    const up = 0.5 - 0.5 * Math.cos(th);
    return [-29 + 52 * u + 5.5 * Math.sin(th) + 0.4 * h * up, 11 - h * up];
  }),
  2,
  0.9,
);

const CHECKLIST = [
  box(-27, -18, 11, 1),
  stroke(-9, 24, -12, 3),
  box(-27, 4, 11, 5),
  stroke(-9, 15, 10, 8),
];

type Window = readonly [number, number];

interface MarkShape {
  lines: readonly MarkLine[];
  boil?: number;
  window?: Window;
}

function writeWindow(t: number, period: number): Window {
  const u = (t / period) % 1;
  if (u < 0.6) return [0, u / 0.6];
  if (u < 0.78) return [0, 1];
  return [(u - 0.78) / 0.22, 1];
}

export function markShape(id: StatusMarkId, t: number): MarkShape {
  switch (id) {
    case 'idle':
      return { lines: [SPIRAL], boil: 520 };
    case 'think': {
      const k = Math.floor(t / 150);
      const a = 0.8 + 0.3 * Math.sin(k * 2.3);
      const tilt = k * 1.7;
      return {
        lines: [
          range(70, (u) => {
            const th = u * Math.PI * 4.6 + tilt;
            const r = 16 + 7 * Math.sin(th * 1.6 + k);
            return [r * Math.cos(th) * a, r * Math.sin(th) * (1.95 - a)];
          }),
        ],
      };
    }
    case 'write':
      return { lines: [CURSIVE], window: writeWindow(t, 2100), boil: 170 };
    case 'look':
      return { lines: READ, window: writeWindow(t, 2400), boil: 170 };
    case 'run':
      return {
        lines: [
          range(56, (u) => [
            -34 + 68 * u,
            (8 + 3 * Math.sin(t / 310)) * Math.sin(u * Math.PI * 7 - t / 150),
          ]),
        ],
        boil: 140,
      };
    case 'task':
      return { lines: CHECKLIST, window: writeWindow(t, 2600), boil: 170 };
    case 'ask':
      return {
        lines: [BUBBLE.map(([x, y]): MarkPoint => [x, y + 1.6 * Math.sin(t / 420)])],
        boil: 260,
      };
    case 'done':
      return { lines: [CHECK], boil: 600 };
    case 'error':
      return { lines: CROSS, boil: 170 };
    case 'offline': {
      const px = -60 + 150 * ((t / 2200) % 1);
      return {
        lines: [
          range(70, (v) => {
            const x = -36 + 72 * v;
            const d = (x - px) / 6;
            return [x, 4 - 15 * Math.exp(-d * d) * Math.sin(d * 2.4)];
          }),
        ],
      };
    }
  }
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

function cut(line: MarkLine, a: number, b: number): MarkLine {
  const n = line.length - 1;
  const i0 = Math.floor(a * n);
  const i1 = Math.max(i0 + 1, Math.ceil(b * n));
  return line.slice(i0, i1 + 1);
}

export type Pen = readonly [number, number];

export const FULL_PEN: Pen = [0, 1];

export function markPath(id: StatusMarkId, t: number, pen: Pen, still: boolean): string {
  const shape = markShape(id, still ? 0 : t);
  const k = still || shape.boil == null ? 0 : Math.floor(t / shape.boil) + 1;
  const total = shape.lines.length;
  return shape.lines
    .map((line, li) => {
      let a = pen[0];
      let b = pen[1];
      if (total > 1) {
        a = clamp01(a * total - li);
        b = clamp01(b * total - li);
      }
      if (shape.window != null && !still) {
        a = Math.max(a, clamp01(shape.window[0] * total - li));
        b = Math.min(b, clamp01(shape.window[1] * total - li));
      }
      if (b - a <= 0.001) return '';
      const points = cut(line, a, b).map(([x, y], i) => {
        const jx = k === 0 ? 0 : 0.9 * Math.sin(i * 0.31 + k * 7.1);
        const jy = k === 0 ? 0 : 0.9 * Math.cos(i * 0.27 + k * 3.3);
        return `${(x + jx).toFixed(1)} ${(y + jy).toFixed(1)}`;
      });
      return `M${points.join('L')}`;
    })
    .join('');
}

const easeOut = (x: number) => 1 - (1 - x) ** 3;

export interface MarkFrame {
  shown: StatusMarkId;
  pen: Pen;
}

export function transitionFrame(
  shown: StatusMarkId,
  next: StatusMarkId,
  sinceChange: number,
  still: boolean,
): MarkFrame {
  if (still) return { shown: next, pen: FULL_PEN };
  if (shown !== next && sinceChange < MARK_ERASE_MS)
    return { shown, pen: [Math.min(0.985, easeOut(sinceChange / MARK_ERASE_MS)), 1] };
  if (sinceChange >= MARK_ERASE_MS && sinceChange < MARK_ERASE_MS + MARK_DRAW_MS)
    return {
      shown: next,
      pen: [0, Math.max(0.015, easeOut((sinceChange - MARK_ERASE_MS) / MARK_DRAW_MS))],
    };
  return { shown: next, pen: FULL_PEN };
}
