import { GitPullRequest } from 'lucide-react';
import { useState } from 'react';
import { ComposerCard } from '../components/composer/composer-card.js';
import { ListCard } from '../components/list-card.js';
import { SegmentedRadio, SegmentedTabs } from '../components/segmented.js';
import { ActivityFold } from '../components/thread/activity-fold.js';
import { CommitRow } from '../components/thread/commit-row.js';
import { DiffFile } from '../components/thread/diff-file.js';
import { NextSteps } from '../components/thread/next-steps.js';
import { PermissionCard, type PermissionChoice } from '../components/thread/permission-card.js';
import { PlanApproval } from '../components/thread/plan-approval.js';
import { PlanBlock, type PlanItem } from '../components/thread/plan-block.js';
import { PrBar } from '../components/thread/pr-bar.js';
import { ProposalCard } from '../components/thread/proposal-card.js';
import { ScheduledTaskRow } from '../components/thread/scheduled-task-row.js';
import { UsageStrip } from '../components/thread/usage-strip.js';
import { Button } from '../components/ui/button.js';
import { toastSuccess } from '../components/ui/toaster.js';
import { toastUndo, UndoToast } from '../components/undo-toast.js';
import { Cell, Section, Specimen } from './specimen.js';

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
      <Specimen title="Permission card, resolved variants" stage="canvas" className="flex-col">
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

const PLAN_LABELS = [
  'Add thread_id to schedule runs',
  'Wake the existing thread with a run marker',
  'Fall back to a new thread when the old one is archived',
  'Test: three runs land in one thread',
] as const;

export function PlanSection() {
  const [approved, setApproved] = useState(false);
  const items: PlanItem[] = PLAN_LABELS.map((label, i) => ({
    label,
    status: approved ? (i === 0 ? 'now' : 'pending') : 'pending',
  }));
  return (
    <Section
      id="plan"
      title="Plan, activity and usage"
      lede="A thread detail reads top to bottom: plan, a folded activity line, the answer, next steps, and a usage strip."
    >
      <Specimen
        title="Plan approval"
        note={approved ? 'Approved' : 'Waiting for approval'}
        stage="canvas"
        code={`<PlanBlock items={[{ label: 'Add thread_id', status: 'now' }]} />\n<PlanApproval approved={false} onApprove={...} onEdit={...} />`}
      >
        <div className="flex w-full max-w-130 flex-col gap-3">
          <PlanBlock items={items} />
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
      <Specimen title="Plan item states" stage="canvas" code={`status: 'pending' | 'now' | 'done'`}>
        <PlanBlock
          className="w-full max-w-130"
          items={[
            { label: 'Device receipts table', status: 'done' },
            { label: 'Receipt endpoint', status: 'done' },
            { label: 'Device receipt test', status: 'now' },
            { label: 'Quiet while viewing', status: 'pending' },
          ]}
        />
      </Specimen>
      <Specimen
        title="Activity fold and usage strip"
        note="Click the fold to list the commands"
        stage="canvas"
        code={`<ActivityFold summary="Edited 2 files, ran 3 commands · 2m 10s" lines={[{ text: '$ pnpm test' }]} />\n<UsageStrip cost="$1.42" tokens="212k" cached="91%" duration="6m 02s" model="Opus 5.5" machine="omarchy" />`}
      >
        <div className="flex w-full max-w-130 flex-col gap-4">
          <ActivityFold summary="Read 9 files, ran 4 commands · 6m" />
          <ActivityFold
            defaultOpen
            summary="Edited 2 files, ran 3 commands · 2m 10s"
            lines={[
              { text: 'edit packages/shared/src/schema.ts +12' },
              { text: '$ pnpm drizzle-kit generate' },
              { text: '$ pnpm --filter server test schema' },
              { text: '✓ 18 passed', ok: true },
            ]}
          />
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

export function ComposerSection() {
  const [value, setValue] = useState('');
  const [queued, setQueued] = useState<string[]>(['Also run the e2e suite', 'Then open the PR']);
  return (
    <Section
      id="composer"
      title="Composer"
      lede="The input card. While a turn runs, Enter steers the current turn and Cmd+Enter queues a message; queued messages show as chips above the text and can be sent now or removed."
    >
      <Specimen
        title="Running turn with queued messages"
        note="Remove a chip or send it now"
        stage="canvas"
        code={`<ComposerCard\n  value={value}\n  onValueChange={setValue}\n  placeholder="Steer this thread…"\n  model="Opus 5.5"\n  effort="Medium"\n  queued={['Also run the e2e suite']}\n  running\n  steer\n/>`}
      >
        <ComposerCard
          className="w-full max-w-170"
          value={value}
          onValueChange={setValue}
          placeholder="Steer this thread… Enter adds to the current turn"
          model="Opus 5.5"
          effort="Medium"
          queued={queued}
          onSendQueued={(i) => {
            toastSuccess(`Sent: ${queued[i] ?? ''}`);
            setQueued(queued.filter((_, j) => j !== i));
          }}
          onRemoveQueued={(i) => setQueued(queued.filter((_, j) => j !== i))}
          running
          steer
        />
      </Specimen>
      <Specimen title="Idle and error" stage="canvas" className="flex-col">
        <ComposerCard
          className="w-full max-w-170"
          value=""
          onValueChange={() => undefined}
          placeholder="Ask the Coordinator, or describe a new thread…"
          model="Opus 5.5"
          effort="High"
        />
        <ComposerCard
          className="w-full max-w-170"
          value="Plan the next batch from issues labelled B2."
          onValueChange={() => undefined}
          placeholder="Ask the Coordinator…"
          model="Opus 5.5"
          effort="High"
          error="Could not reach the Coordinator. The server returned 502; your message is kept."
        />
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
      <Specimen title="CI states and merged" stage="canvas" className="flex-col">
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

export function UndoToastSection() {
  return (
    <Section
      id="undo-toast"
      title="Undo toast"
      lede="Bulk and destructive-but-reversible actions confirm with a toast that offers Undo and the Cmd+Z shortcut, instead of a confirmation dialog."
    >
      <Specimen
        title="Undo toast"
        note="Fire it, then press Cmd+Z or click Undo"
        stage="canvas"
        code={`toastUndo('Resolved 2 threads', () => restore())\n<UndoToast text="Archived cairn" onUndo={restore} />`}
      >
        <Cell label="live (bottom left)">
          <Button
            variant="outline"
            onClick={() =>
              toastUndo('Snoozed “Automation badge and popover” until needed', () =>
                toastSuccess('Snooze undone'),
              )
            }
          >
            Snooze a thread
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              toastUndo('Resolved 2 threads', () => toastSuccess('Restored 2 threads'))
            }
          >
            Resolve two
          </Button>
        </Cell>
        <Cell label="static">
          <UndoToast text="Archived cairn" onUndo={() => undefined} />
        </Cell>
      </Specimen>
    </Section>
  );
}

const DIFF_A = [
  { no: '1', kind: 'add', text: '+export function TurnFold({ turn }: { turn: Turn }) {' },
  {
    no: '2',
    kind: 'add',
    text: '+  const label = foldLabel(turn);',
  },
  { no: '3', kind: 'add', text: '+  return <Collapsible title={label}>{turn.rows}</Collapsible>;' },
  { no: '4', kind: 'add', text: '+}' },
] as const;

const DIFF_B = [
  { no: '211', kind: 'context', text: ' {items.map((item) => (' },
  { no: '212', kind: 'del', text: '-  {item.tools?.map((tool) => <ToolRow tool={tool} />)}' },
  { no: '212', kind: 'add', text: '+  <TurnFold turn={turnOf(item)} />' },
] as const;

export function ChangesSection() {
  const [view, setView] = useState<'changes' | 'commits' | 'checks'>('changes');
  return (
    <Section
      id="changes"
      title="Diff and commits"
      lede="The expanded thread's right-hand panel: Changes, Commits and Checks views, a diff block per file, and a commit row with the short sha."
    >
      <Specimen
        title="Changes, Commits and Checks"
        stage="canvas"
        code={`<SegmentedTabs label="View" value={view} onChange={setView} options={[{ value: 'changes', label: 'Changes' }]} />\n<DiffFile path="…" added={96} removed={0} lines={lines} />\n<CommitRow sha="a41c9e2" message="…" trailer="Cairn-Thread" />`}
      >
        <div className="flex w-full max-w-170 flex-col gap-3">
          <SegmentedTabs
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: 'changes', label: 'Changes' },
              { value: 'commits', label: 'Commits' },
              { value: 'checks', label: 'Checks' },
            ]}
          />
          {view === 'changes' && (
            <>
              <DiffFile
                path="apps/web/src/chief/turn-fold.tsx"
                added={96}
                removed={0}
                lines={DIFF_A}
              />
              <DiffFile
                path="apps/web/src/chief/chief-message-rows.tsx"
                added={18}
                removed={31}
                lines={DIFF_B}
              />
            </>
          )}
          {view === 'commits' && (
            <ListCard className="px-3.5 py-1">
              <CommitRow
                sha="a41c9e2"
                message="web: fold finished turns into purpose and duration"
                trailer="Cairn-Thread"
              />
              <CommitRow
                sha="7d0b311"
                message="web: pin fold header geometry"
                trailer="Cairn-Thread"
              />
              <CommitRow
                sha="e93f2aa"
                message="web: screenshots for the fold"
                trailer="Cairn-Thread"
              />
            </ListCard>
          )}
          {view === 'checks' && (
            <p className="m-0 text-ui text-content-secondary">6 of 6 checks passed.</p>
          )}
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
