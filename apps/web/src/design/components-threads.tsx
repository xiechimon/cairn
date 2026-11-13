import type { PrPanelRow } from '@cairn/shared';
import { GitPullRequest } from 'lucide-react';
import { useState } from 'react';
import { ListCard } from '../components/list-card.js';
import { SegmentedRadio } from '../components/segmented.js';
import { NextSteps } from '../components/thread/next-steps.js';
import { PermissionCard, type PermissionChoice } from '../components/thread/permission-card.js';
import { PlanApproval } from '../components/thread/plan-approval.js';
import { PrBar } from '../components/thread/pr-bar.js';
import { PrCard } from '../components/thread/pr-card.js';
import type { PrCardModel } from '../components/thread/pr-card-model.js';
import { PrList } from '../components/thread/pr-list.js';
import { ProposalCard } from '../components/thread/proposal-card.js';
import { ScheduledTaskRow } from '../components/thread/scheduled-task-row.js';
import { TaskPrLine } from '../components/thread/task-pr-line.js';
import { TaskRow } from '../components/thread/task-row.js';
import { UsageStrip } from '../components/thread/usage-strip.js';
import { Button } from '../components/ui/button.js';
import { toastSuccess } from '../components/ui/toaster.js';
import { Section, Specimen } from './specimen.js';

export function PermissionSection() {
  const [resolution, setResolution] = useState<PermissionChoice | null>(null);
  const [proposal, setProposal] = useState<'proposed' | 'applied' | 'dismissed'>('proposed');
  return (
    <Section
      id="permission"
      title="Permission and proposal cards"
      lede="Two cards the agent puts in the stream when it needs a decision. The permission card is ochre-outlined until answered, then folds to one line; a proposal is dashed until you apply it."
    >
      <Specimen
        id="permission-card"
        title="Permission card"
        note={resolution == null ? 'Pending' : 'Resolved'}
        stage="canvas"
        code={`<PermissionCard\n  title="Allow this command on omarchy?"\n  command={'$ pnpm db:migrate'}\n  help="Writes to the self-use database."\n  alwaysLabel="Always allow in this project"\n  resolution={null}\n  onChoose={(choice) => ...}\n/>`}
      >
        <div className="flex w-full max-w-130 flex-col gap-4">
          <PermissionCard
            title="Allow this command on omarchy?"
            command={
              '$ pnpm db:migrate\n+ ALTER TABLE thread ADD COLUMN snooze_until integer;\n+ ALTER TABLE thread ADD COLUMN snooze_reason text;'
            }
            help="Writes to the self-use database. A backup ran 47 minutes ago."
            alwaysLabel="Always allow in this project"
            resolution={resolution}
            resolvedBy="ian"
            resolvedAt="just now"
            onChoose={setResolution}
          />
          <div>
            <Button size="sm" variant="outline" onClick={() => setResolution(null)}>
              Reset
            </Button>
          </div>
        </div>
      </Specimen>
      <Specimen
        id="permission-card-resolved-variants"
        title="Permission card, resolved variants"
        stage="canvas"
        className="flex-col"
      >
        {(['once', 'deny', 'always'] as const).map((choice) => (
          <PermissionCard
            key={choice}
            className="max-w-130"
            title=""
            command="pnpm db:migrate"
            alwaysLabel=""
            resolution={choice}
            resolvedBy="ian"
            resolvedAt="just now"
          />
        ))}
      </Specimen>
      <Specimen
        id="proposal-card"
        title="Proposal card"
        note={proposal}
        stage="canvas"
        code={`<ProposalCard\n  status="proposed"\n  title="Proposed scheduled task: Weekly flaky-test sweep"\n  description="Every Friday at 18:00, re-run the e2e suite five times."\n  meta="Weekly · Fri 18:00 · Opus 5.5 · omarchy"\n  appliedTitle="Scheduled: Weekly flaky-test sweep"\n  openLabel="Open scheduled task"\n/>`}
      >
        <div className="flex w-full max-w-130 flex-col gap-4">
          {proposal !== 'dismissed' && (
            <ProposalCard
              status={proposal}
              title="Proposed scheduled task: Weekly flaky-test sweep"
              description="Every Friday at 18:00, re-run the e2e suite five times on main and open one thread per flaky test."
              meta="Weekly · Fri 18:00 · Opus 5.5 · omarchy"
              appliedTitle="Scheduled: Weekly flaky-test sweep"
              openLabel="Open scheduled task"
              onApply={() => setProposal('applied')}
              onDismiss={() => setProposal('dismissed')}
              onEdit={() => toastSuccess('Editor opened')}
              onOpen={() => toastSuccess('Scheduled task opened')}
            />
          )}
          <div>
            <Button size="sm" variant="outline" onClick={() => setProposal('proposed')}>
              Reset
            </Button>
          </div>
        </div>
      </Specimen>
    </Section>
  );
}

export function PlanSection() {
  const [approved, setApproved] = useState(false);
  return (
    <Section
      id="plan"
      title="Plan approval, usage and next steps"
      lede="The plan approval row, then the usage strip and next steps that close a thread detail."
    >
      <Specimen
        id="plan-approval"
        title="Plan approval"
        note={approved ? 'Approved' : 'Waiting for approval'}
        stage="canvas"
        code={`<PlanApproval approved={false} onApprove={...} onEdit={...} />`}
      >
        <div className="flex w-full max-w-130 flex-col gap-3">
          <PlanApproval
            approved={approved}
            approvedText="Approved by ian · reading schedule-runner.ts"
            onApprove={() => setApproved(true)}
            onEdit={() => toastSuccess('Plan editor opened')}
          />
          <div>
            <Button size="sm" variant="outline" onClick={() => setApproved(false)}>
              Reset
            </Button>
          </div>
        </div>
      </Specimen>
      <Specimen
        id="usage-strip-and-next-steps"
        title="Usage strip and next steps"
        stage="canvas"
        code={`<UsageStrip cost="$1.42" tokens="212k" cached="91%" duration="6m 02s" model="Opus 5.5" machine="omarchy" />`}
      >
        <div className="flex w-full max-w-130 flex-col gap-4">
          <UsageStrip
            cost="$1.42"
            tokens="212k"
            cached="91%"
            duration="6m 02s"
            model="Opus 5.5"
            machine="omarchy"
          />
          <NextSteps
            steps={[
              {
                label: 'Review PR',
                icon: <GitPullRequest />,
                onClick: () => toastSuccess('Review opened'),
              },
              { label: 'Update base' },
              { label: 'Ship' },
            ]}
          />
        </div>
      </Specimen>
    </Section>
  );
}

export function PrBarSection() {
  const [autoFix, setAutoFix] = useState(true);
  const [autoMerge, setAutoMerge] = useState(false);
  return (
    <Section
      id="pr-bar"
      title="Pull request bar"
      lede="Sits above the composer in a thread with a PR. The CI chip opens a popover with the automation toggles; an option that cannot be turned on says why."
    >
      <Specimen
        id="open-pr"
        title="Open PR"
        note="Open the CI chip"
        stage="canvas"
        code={`<PrBar\n  number={2271}\n  branch="cairn/fold-turns-2235"\n  ci={{ state: 'passed', passed: 6, total: 6 }}\n  autoFix={autoFix}\n  onAutoFixChange={setAutoFix}\n  autoMerge={autoMerge}\n  onAutoMergeChange={setAutoMerge}\n  lockedOption={{ label: 'Merge without review', reason: 'Off for protected paths.' }}\n/>`}
      >
        <PrBar
          className="w-full max-w-130"
          number={2271}
          branch="cairn/fold-turns-2235"
          ci={{ state: 'passed', passed: 6, total: 6 }}
          autoFix={autoFix}
          onAutoFixChange={setAutoFix}
          autoMerge={autoMerge}
          onAutoMergeChange={setAutoMerge}
          lockedOption={{
            label: 'Merge without review',
            reason: 'Off for protected paths. This PR touches apps/server/src/services/secrets.ts.',
          }}
          onMerge={() => toastSuccess('Merge requested')}
        />
      </Specimen>
      <Specimen
        id="ci-states-and-merged"
        title="CI states and merged"
        stage="canvas"
        className="flex-col"
      >
        <PrBar
          className="w-full max-w-130"
          number={2272}
          branch="cairn/receipts-2228"
          ci={{ state: 'running', passed: 3, total: 6 }}
          autoFix
          onAutoFixChange={() => undefined}
          autoMerge={false}
          onAutoMergeChange={() => undefined}
          lockedOption={{
            label: 'Merge without review',
            reason: 'Draft pull requests cannot skip review.',
          }}
        />
        <PrBar
          className="w-full max-w-130"
          number={2273}
          branch="cairn/orb-provider-2274"
          ci={{ state: 'failed', passed: 5, total: 6 }}
          autoFix
          onAutoFixChange={() => undefined}
          autoMerge={false}
          onAutoMergeChange={() => undefined}
        />
        <PrBar
          className="w-full max-w-130"
          merged
          number={2271}
          branch="cairn/fold-turns-2235"
          ci={{ state: 'passed', passed: 6, total: 6 }}
          autoFix={false}
          onAutoFixChange={() => undefined}
          autoMerge={false}
          onAutoMergeChange={() => undefined}
        />
      </Specimen>
    </Section>
  );
}

const PR_CARD_BASE: PrCardModel = {
  number: 2512,
  title: 'web: PR card shows the gate verdict',
  branch: 'cairn/pr-card-2512',
  base: 'main',
  repo: 'xiechimon/cairn',
  additions: 184,
  deletions: 31,
  state: 'open',
  checks: { passed: 6, failed: 0, running: 0, total: 6 },
  verdict: null,
  currentHead: '4f8e2c1',
};

const PR_CARD_LENSES = [
  { name: 'Correctness', result: 'pass' },
  { name: 'Security', result: 'pass' },
  { name: 'Tests', result: 'pass' },
] as const;

const PR_CARD_CASES: { label: string; pr: PrCardModel }[] = [
  {
    label: 'Open',
    pr: { ...PR_CARD_BASE, checks: { passed: 0, failed: 0, running: 0, total: 6 } },
  },
  {
    label: 'Conflicts',
    pr: { ...PR_CARD_BASE, state: 'conflicts', blockers: ['Conflicts with main in 2 files'] },
  },
  {
    label: 'Checks running',
    pr: {
      ...PR_CARD_BASE,
      state: 'checks-running',
      checks: { passed: 3, failed: 0, running: 3, total: 6 },
    },
  },
  {
    label: 'Checks failed',
    pr: {
      ...PR_CARD_BASE,
      state: 'checks-failed',
      checks: {
        passed: 4,
        failed: 2,
        running: 0,
        total: 6,
        failedNames: ['typecheck', 'web e2e (3)'],
      },
      blockers: ['typecheck failed', 'web e2e failed'],
    },
  },
  {
    label: 'Review BLOCK',
    pr: {
      ...PR_CARD_BASE,
      state: 'review-block',
      verdict: {
        result: 'block',
        judgedHead: '4f8e2c1',
        lenses: [
          { name: 'Correctness', result: 'block' },
          { name: 'Security', result: 'pass' },
          { name: 'Tests', result: 'pass' },
        ],
      },
      blockers: ['Stale cache read in merge-readiness.ts'],
    },
  },
  {
    label: 'Review PASS',
    pr: {
      ...PR_CARD_BASE,
      state: 'review-pass',
      verdict: { result: 'pass', judgedHead: '4f8e2c1', lenses: [...PR_CARD_LENSES] },
    },
  },
  {
    label: 'Stale verdict',
    pr: {
      ...PR_CARD_BASE,
      state: 'review-pass',
      currentHead: '9d03b7a',
      verdict: { result: 'pass', judgedHead: '4f8e2c1', lenses: [...PR_CARD_LENSES] },
    },
  },
  {
    label: 'Queued',
    pr: {
      ...PR_CARD_BASE,
      state: 'queued',
      queuePosition: 2,
      verdict: { result: 'pass', judgedHead: '4f8e2c1', lenses: [...PR_CARD_LENSES] },
    },
  },
  {
    label: 'Merged',
    pr: {
      ...PR_CARD_BASE,
      state: 'merged',
      verdict: { result: 'pass', judgedHead: '4f8e2c1', lenses: [...PR_CARD_LENSES] },
    },
  },
  {
    label: 'Owner route',
    pr: {
      ...PR_CARD_BASE,
      state: 'owner-route',
      ownerRoute: 'Touches apps/server/src/services/secrets.ts; ian merges',
      verdict: { result: 'pass', judgedHead: '4f8e2c1', lenses: [...PR_CARD_LENSES] },
    },
  },
];

const PR_LIST_HEAD = '4f8e2c1d9b0a63e57c1f08a2d4b6e9137a5c80de';

function prListRow(
  index: number,
  over: Partial<PrPanelRow> & Pick<PrPanelRow, 'title' | 'checks'>,
): PrPanelRow {
  return {
    buildId: `build-${index}`,
    threadId: `thread-${index}`,
    projectId: 'project-1',
    repo: 'xiechimon/cairn',
    number: 3190 - index,
    url: `https://github.com/xiechimon/cairn/pull/${3190 - index}`,
    state: 'open',
    mergeState: 'clean',
    additions: 24 * (index + 1),
    deletions: 6 * (index + 1),
    branch: 'cairn/feature',
    base: 'main',
    head: PR_LIST_HEAD,
    checksReadFor: PR_LIST_HEAD,
    verdict: null,
    autoFix: true,
    mergeWhenReady: false,
    autoArchive: true,
    dismissed: false,
    blockedSince: null,
    wakeRounds: 0,
    lastReadAt: 0,
    ...over,
  };
}

const PR_LIST_ROWS: PrPanelRow[] = [
  prListRow(0, {
    title: 'web(3122): thread-owned PR panel',
    checks: { passed: 9, failed: 0, running: 0, total: 9, failedNames: [] },
  }),
  prListRow(1, {
    title: 'server(3189): wake thread sessions for PR auto-fixes',
    checks: { passed: 6, failed: 2, running: 1, total: 9, failedNames: ['lint', 'e2e (1)'] },
  }),
  prListRow(2, {
    title: 'docs(3000): keep live counts in sync',
    state: 'merged',
    checks: { passed: 23, failed: 0, running: 0, total: 23, failedNames: [] },
  }),
];

export function PrListSection() {
  return (
    <Section
      id="pr-list"
      title="PR list"
      lede="Every thread-owned pull request as dense rows: icon, title, repo and number, line counts and a CI dot with its count. The menu holds Open on GitHub, Copy link and View changes."
    >
      <Specimen
        id="pr-list"
        title="PR list"
        stage="canvas"
        code="<PrList rows={rows} onOpenThread={...} onViewChanges={...} />"
      >
        <div className="w-full max-w-110">
          <PrList
            rows={PR_LIST_ROWS}
            onOpenThread={() => toastSuccess('Thread opened')}
            onViewChanges={() => toastSuccess('Changes opened')}
          />
        </div>
      </Specimen>
      <Specimen
        id="task-pr-line"
        title="Task PR line"
        stage="canvas"
        code="<TaskPrLine prs={rows} now={Date.now()} />"
      >
        <div className="w-full max-w-110 pt-3">
          <TaskPrLine prs={PR_LIST_ROWS} now={Date.now()} />
        </div>
      </Specimen>
    </Section>
  );
}

export function PrCardSection() {
  return (
    <Section
      id="pr-card"
      title="PR card"
      lede="The merge gate's verdict for a pull request as one card in the thread, bound to the head it was judged on. When the head moves past the judged head the card asks for a re-review instead of saying ready."
    >
      <Specimen
        id="pr-card"
        title="PR card"
        stage="canvas"
        code="<PrCard pr={prCardModel(facts, readiness)} onViewDiff={...} onResolve={...} githubHref={url} />"
      >
        <div
          data-pr-card-grid=""
          className="grid w-full grid-cols-[repeat(auto-fill,minmax(min(26rem,100%),1fr))] gap-4"
        >
          {PR_CARD_CASES.map(({ label, pr }) => (
            <div key={label} data-pr-card-case={label} className="flex min-w-0 flex-col gap-1.5">
              <span className="text-caption text-content-tertiary">{label}</span>
              <PrCard
                pr={pr}
                githubHref="https://github.com/xiechimon/cairn/pull/2512"
                onResolve={() => toastSuccess('Resolve requested')}
                onViewDiff={() => toastSuccess('Diff opened')}
              />
            </div>
          ))}
        </div>
      </Specimen>
    </Section>
  );
}

export function ScheduledSection() {
  const [trigger, setTrigger] = useState('weekly');
  return (
    <Section
      id="scheduled"
      title="Scheduled task row"
      lede="One row per scheduled task: a still clock mark, name, trigger and next run, and a state tag. Active runs; Paused waits; Auto-disabled needs your attention."
    >
      <Specimen
        id="row-states"
        title="Row states"
        stage="canvas"
        code={`<ScheduledTaskRow name="Nightly e2e sweep" trigger="Daily at 02:00" next="Sat Nov 1, 02:00" state="active" />`}
      >
        <ListCard className="w-full max-w-130">
          <ScheduledTaskRow
            name="Nightly e2e sweep"
            trigger="Daily at 02:00"
            next="Sat Nov 1, 02:00"
            state="active"
          />
          <ScheduledTaskRow name="Dependency bump" trigger="Weekly · Mon 09:00" state="paused" />
          <ScheduledTaskRow name="Flip detector" trigger="Hourly" state="disabled" />
        </ListCard>
      </Specimen>
      <Specimen
        id="trigger"
        title="Trigger"
        note="The existing segmented control picks how a task repeats"
        stage="canvas"
        code={`<SegmentedRadio label="Trigger" value={trigger} onChange={setTrigger} options={[{ value: 'daily', label: 'Daily' }]} />`}
      >
        <SegmentedRadio
          label="Trigger"
          value={trigger}
          onChange={setTrigger}
          options={[
            { value: 'once', label: 'Once' },
            { value: 'hourly', label: 'Hourly' },
            { value: 'daily', label: 'Daily' },
            { value: 'weekdays', label: 'Weekdays' },
            { value: 'weekly', label: 'Weekly' },
            { value: 'cron', label: 'Custom cron' },
          ]}
        />
      </Specimen>
    </Section>
  );
}

export function TaskRowSection() {
  return (
    <Section
      id="task-row"
      title="Task row"
      lede="A row in the Tasks panel: status glyph, title and age, then the status word with what is waiting, then where to act. A row the owner can mark done leads with the checkbox; any other row leads with one quiet glyph in the same spot whose tooltip says why. Only rows waiting on the owner add an action line."
    >
      <Specimen
        id="task-row"
        title="Task row"
        stage="canvas"
        code="<TaskRow title glyph why word what where age waiting onOpen />"
      >
        <div className="flex w-full max-w-110 flex-col">
          <TaskRow
            title="Inventory MCP servers across machines and keep secrets local"
            glyph="three-quarter"
            check={{ label: 'Mark done', onCheck: () => toastSuccess('Marked done') }}
            word="Ready for review"
            what="PR #3558: all checks passed (41/41)"
            where="Merge on the PR card"
            age="22 min ago"
            waiting
            onOpen={() => toastSuccess('Task opened')}
          />
          <TaskRow
            title="Remove Feishu entirely, or keep the notification channel?"
            glyph="question"
            why="A question from the Coordinator; answer it in the conversation"
            word="Needs input"
            what="Coordinator asks before creating a task"
            where="Choose on the question card"
            age="8 min ago"
            waiting
          />
          <TaskRow
            title="Enforce public-content checks in hooks and CI"
            glyph="failed"
            why="The run failed; rerun it first"
            word="Failed"
            what="The build failed"
            where={null}
            age="12 min"
            waiting={false}
          />
          <TaskRow
            title="Unify the task issue lifecycle"
            glyph="done"
            why="Done"
            word="Done"
            what="PR #3551 merged"
            where={null}
            age="2 h ago"
            waiting={false}
            muted
          />
        </div>
      </Specimen>
    </Section>
  );
}
