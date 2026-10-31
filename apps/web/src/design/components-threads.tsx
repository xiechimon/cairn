import { GitPullRequest } from 'lucide-react';
import { useState } from 'react';
import { ListCard } from '../components/list-card.js';
import { SegmentedRadio } from '../components/segmented.js';
import { NextSteps } from '../components/thread/next-steps.js';
import { PermissionCard, type PermissionChoice } from '../components/thread/permission-card.js';
import { PlanApproval } from '../components/thread/plan-approval.js';
import { PrBar } from '../components/thread/pr-bar.js';
import { ProposalCard } from '../components/thread/proposal-card.js';
import { ScheduledTaskRow } from '../components/thread/scheduled-task-row.js';
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

export function PlanSection() {
  const [approved, setApproved] = useState(false);
  return (
    <Section
      id="plan"
      title="Plan approval, usage and next steps"
      lede="The plan approval row, then the usage strip and next steps that close a thread detail."
    >
      <Specimen
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
