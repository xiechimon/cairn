import { PHASE_VALUES } from '@cairn/shared';
import { cn } from 'cn';
import { useRef, useState } from 'react';
import { Button } from '../components/ui/button.js';
import { MessageScrollerProvider } from '../components/ui/message-scroller.js';
import { AcceptDialog } from '../detail/accept-dialog.js';
import { Composer } from '../detail/composer.js';
import { DetailHead } from '../detail/dhead.js';
import { DocPane } from '../detail/docpane.js';
import { FreshBlock } from '../detail/fresh-block.js';
import { MergeGateVerdict } from '../detail/merge-gate-verdict.js';
import { QueuedMessages } from '../detail/queued-messages.js';
import { RejectDialog } from '../detail/reject-dialog.js';
import { ReviewDialog } from '../detail/review-dialog.js';
import { PaneSections, RightPane } from '../detail/right-pane.js';
import { Segments, TodoStatus } from '../detail/segments.js';
import { SourceIssueLine } from '../detail/source-issue.js';
import { SpecBlock } from '../detail/spec-block.js';
import { StopConfirmDialog } from '../detail/stop-confirm-dialog.js';
import { TaskMetaBlock } from '../detail/task-meta-block.js';
import { InjectedSkills, WorkTrace } from '../detail/work-trace.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { serializeMention } from '../overlay/mention-token.js';
import { MoreMenu } from '../overlay/more-menu.js';
import type { DocView } from '../overlay/plan-dropdown.js';
import { PHASE_UI } from '../phase.js';
import {
  BUILD_CONTENT,
  CHANGES,
  MENTION_GROUPS,
  MERGE_BLOCKED,
  MERGE_READY,
  NOW,
  PLAN_DOC,
  PROJECT_TITLE,
  sharedTodo,
  TAGS,
  TASK_META,
  TASK_META_WAITING,
  TRANSCRIPT_WORK,
  todo,
} from './product-fixtures.js';
import { Cell, Labeled, Section, Specimen } from './specimen.js';

const HEADS: { label: string; todo: TodoRecord; reviewActive?: boolean; inFlight?: boolean }[] = [
  { label: 'To start', todo: todo({ title: 'Add a dark mode toggle to settings', phase: 'todo' }) },
  {
    label: 'To start, orchestrating',
    todo: todo({ title: 'Split the schedules page into tabs', phase: 'todo' }),
    inFlight: true,
  },
  { label: 'Planning', todo: todo({ title: 'Cache the project file tree', phase: 'planning' }) },
  {
    label: 'Confirm plan',
    todo: todo({ title: 'Add retries to the webhook sender', phase: 'confirm' }),
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
        retryAfterMs: null,
        probeAt: NOW,
      },
    }),
  },
  {
    label: 'Review, AI review running',
    todo: todo({ title: 'Paginate the GitHub issues dialog', phase: 'review' }),
    reviewActive: true,
  },
  { label: 'Failed', todo: todo({ title: 'Migrate the schedules table', phase: 'failed' }) },
  {
    label: 'Done, archived',
    todo: todo({ title: 'Remove the legacy token page', phase: 'done', archivedAt: NOW }),
  },
];

const FRESH = todo({ title: 'Add a dark mode toggle to settings', phase: 'todo', phaseAt: NOW });

const MENTION_DRAFT = `Use ${serializeMention({ kind: 'skill', id: 'frontend-design', label: 'frontend-design' })} and ask ${serializeMention({ kind: 'agent', id: 'reviewer', label: 'reviewer' })} to check ${serializeMention({ kind: 'todo', id: 'gallery-44', label: 'Fix the stale branch badge', seq: 44 })}`;

function HeadSpecimen() {
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const first = HEADS[0];
  return (
    <Specimen
      title="Task header"
      note={
        last ?? 'DetailHead: phase chip with its assignment popover, more menu and primary action'
      }
      stage="canvas"
      className="flex-col gap-y-4"
    >
      {HEADS.map((head) => (
        <Labeled key={head.label} label={head.label}>
          <div className="w-full rounded-(--radius-card) bg-background">
            <DetailHead
              todo={head.todo}
              projectName={PROJECT_TITLE}
              agentModel={{ modelId: 'claude-sonnet-5-5', thinkingLevel: 'high' }}
              reviewActive={head.reviewActive}
              actionInFlight={head.inFlight}
              onAction={() => setLast(`Primary action on #${head.todo.seqNum}`)}
              onEditAssign={() => setLast('Edit assignment')}
              onMore={() => setMenuFor(head.label)}
              moreButtonRef={head === first ? moreRef : undefined}
            />
          </div>
        </Labeled>
      ))}
      <MoreMenu
        open={menuFor != null}
        anchor={moreRef}
        onClose={() => setMenuFor(null)}
        onDelete={() => setLast('Delete')}
        onComplete={() => setLast('Complete')}
        canComplete
        onArchive={() => setLast('Archive')}
        onCloseTask={() => setLast('Cancel task')}
        canClose
        onStop={() => setLast('Stop')}
        onReject={() => setLast('Reject')}
      />
    </Specimen>
  );
}

function ComposerSpecimen() {
  const [sent, setSent] = useState<string[]>([]);
  return (
    <Specimen
      title="Composer"
      note={sent.length === 0 ? 'Type / for commands or @ for mentions' : `Sent: ${sent.at(-1)}`}
      stage="canvas"
      className="flex-col gap-y-10"
    >
      <Cell label="Editable, idle">
        <div className="w-160 pt-2">
          <Composer
            placeholder={PHASE_UI.review.placeholder ?? ''}
            aiReview
            streaming={false}
            editable
            mentionGroups={MENTION_GROUPS}
            onSend={(text) => setSent((all) => [...all, text])}
            onReview={() => setSent((all) => [...all, '/review'])}
            onAttachment={(files) => files.map((f) => f.name)}
          />
        </div>
      </Cell>
      <Cell label="Agent running: stop button and queue on send">
        <div className="w-160 pt-2">
          <Composer
            placeholder={PHASE_UI.building.placeholder ?? ''}
            aiReview={false}
            streaming
            editable
            mentionGroups={MENTION_GROUPS}
            onQueue={(text) => setSent((all) => [...all, `queued: ${text}`])}
            onStop={() => setSent((all) => [...all, 'stop'])}
          />
        </div>
      </Cell>
      <Cell label="Draft with mention chips above it">
        <div className="w-160 pt-12">
          <Composer
            placeholder={PHASE_UI.confirm.placeholder ?? ''}
            aiReview={false}
            streaming={false}
            editable
            draft={MENTION_DRAFT}
            mentionGroups={MENTION_GROUPS}
          />
        </div>
      </Cell>
      <Cell label="Read only">
        <div className="w-160">
          <Composer
            placeholder={PHASE_UI.done.placeholder ?? ''}
            aiReview={false}
            streaming={false}
          />
        </div>
      </Cell>
    </Specimen>
  );
}

function PaneSpecimen({ mode }: { mode: 'plan' | 'changes' }) {
  const [view, setView] = useState<DocView>(mode === 'plan' ? 'plan' : 'changes');
  return (
    <div
      className={cn(
        'flex w-full overflow-hidden rounded-(--radius-card) bg-background ring-1 ring-border',
        mode === 'plan' ? 'h-240' : 'h-110',
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col items-center justify-center text-meta text-content-tertiary">
        Conversation column
      </div>
      <RightPane>
        <DocPane
          mode={view}
          doc={PLAN_DOC}
          changes={CHANGES}
          now={NOW}
          onDocView={setView}
          sections={<PaneSections content={BUILD_CONTENT} buildId={null} />}
          planVersions={[
            { v: 'v2', at: NOW - 600_000 },
            { v: 'v1', at: NOW - 3_600_000 },
          ]}
        />
      </RightPane>
    </div>
  );
}

function DialogsSpecimen() {
  const [open, setOpen] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const close = () => setOpen(null);
  const done = (what: string) => {
    setLast(what);
    setOpen(null);
  };
  const triggers = [
    ['accept', 'Accept'],
    ['accept-locked', 'Accept, merge locked'],
    ['accept-info', 'Accept, no code changes'],
    ['reject', 'Reject'],
    ['review', 'Request AI review'],
    ['stop', 'Stop'],
    ['stop-queued', 'Stop, queued'],
  ] as const;
  return (
    <Specimen
      title="Task dialogs"
      note={last == null ? 'Each button opens the real dialog' : `Last: ${last}`}
      stage="canvas"
    >
      {triggers.map(([id, label]) => (
        <Button key={id} variant="outline" onClick={() => setOpen(id)}>
          {label}
        </Button>
      ))}
      <AcceptDialog
        open={open === 'accept'}
        onClose={close}
        onConfirm={(merge) => done(merge ? 'accept and merge' : 'accept')}
        substantiveChanges
      />
      <AcceptDialog
        open={open === 'accept-locked'}
        onClose={close}
        onConfirm={() => done('accept')}
        mergeLocked
        missingTools={['推送分支']}
        rejectReason="The PR still has a failing check."
      />
      <AcceptDialog
        open={open === 'accept-info'}
        onClose={close}
        onConfirm={() => done('accept')}
        infoOutput
      />
      <RejectDialog
        open={open === 'reject'}
        onClose={close}
        onConfirm={(feedback) => done(`reject: ${feedback}`)}
        rejectReason="Tests fail on the remote machine."
      />
      <ReviewDialog
        open={open === 'review'}
        onClose={close}
        agents={[
          { id: 'builder', name: 'builder', model: 'claude-sonnet-5-5', provider: 'anthropic' },
          { id: 'reviewer', name: 'reviewer', model: 'gpt-6.1-sol', provider: 'openai' },
        ]}
        defaultAgentId="reviewer"
        producerProvider="anthropic"
        fanoutAvailable
        onStart={({ agentId }) => done(`review by ${agentId ?? 'fan-out'}`)}
      />
      <StopConfirmDialog
        open={open === 'stop'}
        onClose={close}
        onConfirm={(discard) => done(discard ? 'stop and discard' : 'stop')}
      />
      <StopConfirmDialog
        open={open === 'stop-queued'}
        onClose={close}
        onConfirm={() => done('stop')}
        queued
      />
    </Specimen>
  );
}

export function ProductDetailSection() {
  const { t } = useI18n();
  const [queued, setQueued] = useState([
    { id: 'q1', content: 'Also cover the done column.' },
    { id: 'q2', content: 'And keep the scroll position per project.', error: 'Delivery failed' },
  ]);
  const [last, setLast] = useState<string | null>(null);
  const settle = (what: string) => {
    setLast(what);
    return Promise.resolve();
  };
  return (
    <Section
      id="product-detail"
      title="Task detail"
      lede="The task page: header, the empty-task block, the spec, work traces, queued messages, the composer, the right pane and its dialogs."
    >
      <HeadSpecimen />
      <Specimen
        title="Fresh task"
        note="FreshBlock before the first run"
        stage="sheet"
        className="flex-col"
      >
        <Labeled label="With tags and the start action">
          <FreshBlock
            todo={FRESH}
            tags={TAGS.slice(0, 2)}
            action="开始"
            onAction={() => setLast('start')}
            hasSpec
          />
        </Labeled>
        <Labeled label="No description, orchestrating">
          <FreshBlock todo={FRESH} action="开始" onAction={() => {}} actionInFlight />
        </Labeled>
      </Specimen>
      <Specimen title="Spec and meta" note="SpecBlock, TaskMetaBlock" stage="sheet">
        <Cell label="SpecBlock">
          <div className="w-120">
            <SpecBlock
              spec={
                'Cards should show the branch of the **latest build**.\n\n- Keep the badge hidden while building\n- Cover the done column'
              }
            />
          </div>
        </Cell>
        <Cell label="TaskMetaBlock, full">
          <div className="w-72">
            <TaskMetaBlock meta={TASK_META} now={NOW} />
          </div>
        </Cell>
        <Cell label="TaskMetaBlock, waiting on a machine">
          <div className="w-72">
            <TaskMetaBlock meta={TASK_META_WAITING} now={NOW} />
          </div>
        </Cell>
      </Specimen>
      <Specimen
        title="Source line"
        note="SourceIssueLine for each source kind"
        stage="sheet"
        className="flex-col"
      >
        <Cell label="From a chief orchestration">
          <SourceIssueLine
            todo={sharedTodo({
              title: 'x',
              sourceKind: 'orchestration',
              sourceRef: 'chief:thread-1',
            })}
            onRetry={() => {}}
            retryPending={false}
            onOpenThread={(id) => setLast(`open thread ${id}`)}
          />
        </Cell>
        <Cell label="GitHub issue not created yet">
          <SourceIssueLine
            todo={sharedTodo({ title: 'x', sourceKind: 'github-issue', sourceRef: null })}
            onRetry={() => setLast('retry issue')}
            retryPending={false}
          />
        </Cell>
        <Cell label="Linked issue whose title drifted">
          <SourceIssueLine
            todo={sharedTodo({
              id: 'gallery-echo',
              title: 'Badge shows the wrong branch',
              sourceKind: 'github-issue',
              sourceRef: 'xiechimon/cairn#1182',
            })}
            onRetry={() => {}}
            retryPending={false}
          />
        </Cell>
      </Specimen>
      <Specimen title="Merge gate" note="MergeGateVerdict" stage="canvas">
        <Cell label="Ready">
          <div className="w-100 rounded-(--radius-card) bg-background">
            <MergeGateVerdict state={MERGE_READY} />
          </div>
        </Cell>
        <Cell label="Blocked">
          <div className="w-100 rounded-(--radius-card) bg-background">
            <MergeGateVerdict state={MERGE_BLOCKED} />
          </div>
        </Cell>
      </Specimen>
      <Specimen
        title="Work trace"
        note="WorkTrace collapsed and expanded, InjectedSkills"
        stage="sheet"
        className="flex-col"
      >
        <Cell label="Collapsed summary">
          <div className="w-160">
            <WorkTrace item={TRANSCRIPT_WORK} defaultExpanded={false} entering={new Set()} t={t} />
          </div>
        </Cell>
        <Cell label="Expanded: think, read, search, edit, failed run, running">
          <div className="w-160">
            <WorkTrace item={TRANSCRIPT_WORK} defaultExpanded entering={new Set()} t={t} />
          </div>
        </Cell>
        <Cell label="Injected skills chip">
          <div className="w-160">
            <InjectedSkills
              skills={[
                { id: 'frontend-design', reason: 'UI task' },
                { id: 'verify', reason: 'acceptance' },
              ]}
              t={t}
            />
          </div>
        </Cell>
      </Specimen>
      <Specimen
        title="Queued messages"
        note={last ?? 'QueuedMessages: steer or cancel each one'}
        stage="canvas"
      >
        <div className="flex w-160 flex-col">
          <MessageScrollerProvider>
            <QueuedMessages
              messages={queued}
              onSteer={(id) => settle(`steer ${id}`)}
              onCancel={(id) => {
                setQueued((all) => all.filter((m) => m.id !== id));
                return settle(`cancel ${id}`);
              }}
            />
          </MessageScrollerProvider>
        </div>
      </Specimen>
      <ComposerSpecimen />
      <Specimen
        title="Status and inline segments"
        note="TodoStatus for every phase, Segments with code, links and mentions"
      >
        {PHASE_VALUES.map((phase) => (
          <Cell key={phase} label={phase}>
            <TodoStatus phase={phase} />
          </Cell>
        ))}
        <Cell label="Segments">
          <p className="m-0 text-ui">
            <Segments
              codeClassName="chat-code"
              segments={[
                { text: 'Edited ' },
                { text: 'todo-card.tsx', style: 'code' },
                { text: ' for ' },
                {
                  text: 'Fix the stale branch badge',
                  style: 'mention',
                  mentionKind: 'todo',
                  mentionId: 'gallery-44',
                },
                { text: ' with ' },
                { text: 'reviewer', style: 'mention', mentionKind: 'agent', mentionId: 'reviewer' },
                { text: ', see ' },
                { text: 'PR #1190', style: 'link' },
                { text: ', ' },
                { text: 'important', style: 'strong' },
              ]}
            />
          </p>
        </Cell>
      </Specimen>
      <Specimen
        title="Right pane"
        note="RightPane hosting DocPane. Switch plan and changes from the pane title or header buttons; branch, usage and history are collapsible sections under the plan."
        stage="canvas"
        className="flex-col"
      >
        <Labeled label="Plan">
          <PaneSpecimen mode="plan" />
        </Labeled>
        <Labeled label="Changes">
          <PaneSpecimen mode="changes" />
        </Labeled>
      </Specimen>
      <DialogsSpecimen />
    </Section>
  );
}
