import type {
  ChatChart,
  DiffGlance,
  FsListResult,
  GithubIssueEcho,
  ProjectRecord,
  TodoRecord as SharedTodoRecord,
} from '@cairn/shared';
import type { ChiefQuestionItem } from '../chief/question-item.js';
import type {
  ChangesContent,
  DocBlock,
  FixtureSet,
  TodoRecord,
  TranscriptItem,
} from '../fixtures/records.js';
import type { MentionGroups } from '../overlay/mention-token.js';

export const NOW = Date.parse('2026-10-31T14:00:00+08:00');
const MIN = 60_000;
const HOUR = 60 * MIN;

export const TEAM = 'gallery-team';
export const PROJECT = 'gallery-project';
export const PROJECT_TITLE = 'cairn';

const BUILDER = { id: 'builder', displayName: 'builder' };

let seq = 40;

export function todo(patch: Partial<TodoRecord> & Pick<TodoRecord, 'title' | 'phase'>): TodoRecord {
  seq += 1;
  const started = patch.phase !== 'todo';
  return {
    id: `gallery-${seq}`,
    teamId: TEAM,
    projectId: PROJECT,
    spec: patch.title,
    phaseAt: NOW - 12 * MIN,
    seqNum: seq,
    orderIndex: seq,
    assignment: started ? { agentId: BUILDER.id } : null,
    agent: started ? BUILDER : null,
    latestBuildId: started ? `build-${seq}` : null,
    lastRunAt: started ? NOW - 20 * MIN : null,
    hasChanges: patch.phase === 'review' || patch.phase === 'done',
    hasPlan: patch.phase === 'confirm' || patch.phase === 'review',
    buildHistory: [],
    sourceTodo: null,
    v: 1,
    sourceKind: null,
    sourceRef: null,
    ...patch,
  };
}

export const CARD_FACES: { label: string; todo: TodoRecord }[] = [
  {
    label: 'To start',
    todo: todo({
      title: 'Add a dark mode toggle to settings',
      phase: 'todo',
      phaseAt: NOW - 3 * HOUR,
    }),
  },
  {
    label: 'To start, next in line',
    todo: todo({ title: 'Split the schedules page into tabs', phase: 'todo' }),
  },
  {
    label: 'To start, older',
    todo: todo({ title: 'Rename the API keys page', phase: 'todo' }),
  },
  {
    label: 'Queued',
    todo: todo({ title: 'Upgrade the test runner', phase: 'queued', phaseAt: NOW - 2 * MIN }),
  },
  {
    label: 'Planning',
    todo: todo({
      title: 'Cache the project file tree',
      phase: 'planning',
      phaseAt: NOW - 5 * MIN,
    }),
  },
  {
    label: 'Building',
    todo: todo({
      title: 'Fix the stale branch badge on cards',
      phase: 'building',
      phaseAt: NOW - MIN,
    }),
  },
  {
    label: 'Waiting on quota',
    todo: todo({
      title: 'Translate the onboarding copy',
      phase: 'building',
      quotaWait: {
        kind: 'quota',
        providerId: 'claude',
        label: 'Claude',
        retryAfterMs: 30 * MIN,
        probeAt: NOW + 30 * MIN,
      },
    }),
  },
  {
    label: 'Waiting on a machine',
    todo: todo({
      title: 'Rebuild the search index',
      phase: 'queued',
      waitingOn: { on: 'machine', retryAt: null },
    }),
  },
  {
    label: 'Failed',
    todo: todo({
      title: 'Migrate the schedules table',
      phase: 'failed',
      phaseAt: NOW - 40 * MIN,
    }),
  },
  {
    label: 'Waiting on you',
    todo: todo({ title: 'Choose the export format', phase: 'needs_input' }),
  },
  {
    label: 'Confirm plan',
    todo: todo({
      title: 'Add retries to the webhook sender',
      phase: 'confirm',
      chiefCreated: true,
    }),
  },
  {
    label: 'Review',
    todo: todo({
      title: 'Paginate the GitHub issues dialog',
      phase: 'review',
      phaseAt: NOW - 25 * MIN,
    }),
  },
  {
    label: 'Done',
    todo: todo({
      title: 'Remove the legacy token page',
      phase: 'done',
      phaseAt: NOW - 26 * HOUR,
    }),
  },
  {
    label: 'Canceled',
    todo: todo({
      title: 'Prototype a mobile layout',
      phase: 'closed',
      phaseAt: NOW - 3 * 24 * HOUR,
    }),
  },
  {
    label: 'With tag and cost',
    todo: todo({
      title: 'Fix the composer losing the draft on reload',
      phase: 'review',
      usageCost: { input: 0.42, output: 0.81, cacheRead: 0.12, cacheWrite: 0.06, total: 1.41 },
    }),
  },
  {
    label: 'Unpriced cost, long title',
    todo: todo({
      title:
        'Make the board remember which column was scrolled and restore it after a reload, including the done column',
      phase: 'building',
      usageCost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, priced: false },
    }),
  },
];

export const BOARD_FIXTURE: FixtureSet = {
  now: NOW,
  todos: [
    todo({ title: 'Add a dark mode toggle to settings', phase: 'todo', orderIndex: 1 }),
    todo({
      title: 'Document the release checklist',
      phase: 'todo',
      orderIndex: 2,
    }),
    todo({ title: 'Fix the stale branch badge on cards', phase: 'building', phaseAt: NOW - MIN }),
    todo({ title: 'Upgrade the test runner', phase: 'queued', phaseAt: NOW - 2 * MIN }),
    todo({ title: 'Migrate the schedules table', phase: 'failed', phaseAt: NOW - 4 * MIN }),
    todo({
      title: 'Add retries to the webhook sender',
      phase: 'confirm',
      phaseAt: NOW - 6 * MIN,
    }),
    todo({
      title: 'Paginate the GitHub issues dialog',
      phase: 'review',
      phaseAt: NOW - 8 * MIN,
    }),
    todo({ title: 'Remove the legacy token page', phase: 'done', phaseAt: NOW - HOUR }),
  ],
  projectNames: { [PROJECT]: PROJECT_TITLE },
};

export const TRANSCRIPT_WORK: Extract<TranscriptItem, { kind: 'work' }> = {
  kind: 'work',
  id: 'work-1',
  steps: [
    {
      kind: 'think',
      id: 's1',
      text: 'The badge reads the branch from the card, not from the latest build.',
      seconds: 4,
    },
    {
      kind: 'call',
      id: 's2',
      action: 'read',
      label: 'Read',
      target: 'apps/web/src/board/todo-card.tsx L1-120',
      output: null,
      error: false,
      running: false,
      unfinished: false,
      seconds: 1,
    },
    {
      kind: 'call',
      id: 's3',
      action: 'search',
      label: 'Search',
      target: 'latestBuildId',
      output: '6 matches in 4 files',
      error: false,
      running: false,
      unfinished: false,
      seconds: 1,
    },
    {
      kind: 'call',
      id: 's4',
      action: 'edit',
      label: 'Edit',
      target: 'apps/web/src/board/todo-card.tsx',
      diff: { added: 6, removed: 2 },
      changes: {
        removed: ['const branch = todo.branch;'],
        added: ['const branch = build?.branch ?? null;'],
      },
      output: null,
      error: false,
      running: false,
      unfinished: false,
      seconds: 2,
    },
    {
      kind: 'call',
      id: 's5',
      action: 'run',
      label: 'Run',
      command: 'pnpm exec vitest run board',
      output: '1 failed, 41 passed',
      error: true,
      running: false,
      unfinished: false,
      seconds: 18,
    },
    {
      kind: 'call',
      id: 's6',
      action: 'run',
      label: 'Run',
      command: 'pnpm exec vitest run board',
      output: null,
      error: false,
      running: true,
      unfinished: false,
      seconds: null,
    },
  ],
};

export const PLAN_DOC: DocBlock[] = [
  { kind: 'head', segments: [{ text: 'Goal' }] },
  {
    kind: 'para',
    segments: [
      { text: 'Cards show the branch of the ' },
      { text: 'latest build', style: 'strong' },
      { text: ', not the one stored on the task.' },
    ],
  },
  { kind: 'head', segments: [{ text: 'Steps' }] },
  {
    kind: 'bullet',
    segments: [{ text: 'Read the branch from ' }, { text: 'useBuild', style: 'code' }],
  },
  {
    kind: 'bullet',
    segments: [
      { text: 'Keep the badge hidden while ' },
      {
        text: 'Fix the stale branch badge on cards',
        style: 'mention',
        mentionKind: 'todo',
        mentionId: 'gallery-44',
      },
      { text: ' is still building' },
    ],
  },
];

export const CHANGES: ChangesContent = {
  expanded: true,
  files: [
    {
      path: 'apps/web/src/board/todo-card.tsx',
      added: 2,
      removed: 1,
      hunks: [
        {
          header: '@@ -88,7 +88,8 @@',
          lines: [
            { kind: 'context', text: '  const face = cardFace(todo);', oldNo: 88, newNo: 88 },
            { kind: 'del', text: '  const branch = todo.branch;', oldNo: 89 },
            { kind: 'add', text: '  const build = useBuild(todo.latestBuildId);', newNo: 89 },
            { kind: 'add', text: '  const branch = build?.branch ?? null;', newNo: 90 },
            {
              kind: 'context',
              text: "  const queued = todo.phase === 'queued';",
              oldNo: 90,
              newNo: 91,
            },
          ],
        },
      ],
    },
  ],
};

export const MENTION_GROUPS: MentionGroups = {
  todo: [
    { id: 'gallery-44', label: 'Fix the stale branch badge on cards', seq: 44 },
    { id: 'gallery-48', label: 'Migrate the schedules table', seq: 48 },
  ],
  skill: [
    { id: 'frontend-design', label: 'frontend-design', subtitle: 'Distinctive UI direction' },
    { id: 'verify', label: 'verify', subtitle: 'Prove a change works' },
  ],
  agent: [
    { id: 'builder', label: 'builder', subtitle: 'claude-sonnet-5-5' },
    { id: 'reviewer', label: 'reviewer', subtitle: 'gpt-6.1-sol' },
  ],
  project: [
    { id: PROJECT, label: PROJECT_TITLE },
    { id: 'docs-site', label: 'docs-site' },
  ],
  machine: [{ id: 'studio-mac', label: 'studio-mac', subtitle: 'Online' }],
};

export const QUESTION_PENDING: ChiefQuestionItem = {
  kind: 'question',
  requestId: 'req-1',
  status: 'pending',
  questions: [
    {
      header: 'Scope',
      question: 'Should the export include archived tasks?',
      options: [
        { label: 'Only active tasks', description: 'Smaller file, matches the board' },
        { label: 'Everything', description: 'Includes archived and canceled tasks' },
      ],
    },
    {
      header: 'Format',
      question: 'Which formats do you need?',
      multiSelect: true,
      options: [{ label: 'CSV' }, { label: 'JSON' }, { label: 'Markdown' }],
    },
  ],
  answers: null,
};

export const QUESTION_ANSWERED: ChiefQuestionItem = {
  ...QUESTION_PENDING,
  requestId: 'req-2',
  status: 'answered',
  answers: [
    { header: 'Scope', choices: ['Only active tasks'] },
    { header: 'Format', choices: ['CSV', 'JSON'] },
  ],
};

export const QUESTION_CANCELLED: ChiefQuestionItem = {
  ...QUESTION_PENDING,
  requestId: 'req-3',
  status: 'cancelled',
};

export const ISSUE_ECHO: GithubIssueEcho = {
  number: 1182,
  title: 'Branch badge shows a stale name',
  state: 'open',
};

export const BRANCHES = {
  defaultBranch: 'main',
  branches: [
    { name: 'main', isDefault: true },
    { name: 'release', isDefault: false },
    { name: 'next', isDefault: false },
  ],
};

export const GALLERY_PROJECT: ProjectRecord = {
  id: PROJECT,
  name: PROJECT_TITLE,
  teamId: TEAM,
  splitPolicy: 'human',
  evidenceStore: 'repository',
  repoKind: 'github',
  githubRepo: 'xiechimon/cairn',
  baseBranch: 'release',
};

export const FS_ROOT = '/Users/you/code';

export function fsListing(path: string): FsListResult {
  const depth = path.split('/').filter(Boolean).length;
  return {
    path,
    truncated: false,
    entries:
      depth > 4
        ? []
        : [
            { name: 'cairn', git: true },
            { name: 'docs-site', git: true },
            { name: 'scratch', git: false },
            { name: '.config', git: false },
          ],
  };
}

export function sharedTodo(patch: {
  id?: string;
  title: string;
  sourceKind: SharedTodoRecord['sourceKind'];
  sourceRef: string | null;
}): SharedTodoRecord {
  return {
    ...todo({ title: patch.title, phase: 'todo', ...(patch.id != null ? { id: patch.id } : {}) }),
    sourceKind: patch.sourceKind,
    sourceRef: patch.sourceRef,
    createdBy: null,
    ownerId: null,
    sourceBuildId: null,
    owner: null,
    output: 'code',
  };
}

export const REPLY_GLANCE: DiffGlance = {
  path: 'apps/server/src/services/coupon-split.ts',
  lines: [
    { kind: 'context', old: 15, new: 15, text: 'export function splitCoupon(lines, coupon) {' },
    {
      kind: 'del',
      old: 16,
      text: '  return lines.map((line) => roundCents(line.total * coupon.rate))',
    },
    {
      kind: 'add',
      new: 16,
      text: '  const orderTotal = lines.reduce((sum, line) => sum + line.total, 0)',
    },
    {
      kind: 'add',
      new: 17,
      text: '  return settleRemainder(lines, roundCents(orderTotal * coupon.rate))',
    },
    {
      kind: 'note',
      text: 'The discount is now taken once per order, then split across the lines.',
    },
    { kind: 'context', old: 17, new: 18, text: '}' },
  ],
};

export const REPLY_CHART: ChatChart = {
  type: 'bar',
  title: 'p95 latency, before and after',
  unit: 'ms',
  categories: ['Task list', 'Build detail', 'Search'],
  series: [
    { name: 'Before', values: [820, 1240, 960], role: 'before' },
    { name: 'After', values: [210, 380, 450], role: 'after' },
  ],
  summary: 'The three endpoints dropped 64% on average.',
};
