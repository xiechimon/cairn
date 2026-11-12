import { PHASE_VALUES } from '@cairn/shared';
import { cn } from 'cn';
import { useState } from 'react';
import { TaskRefRow } from '../chief/chief-task-ref-row.js';
import { ComposerAttachmentTile } from '../components/composer-attachment-tile.js';
import { Button } from '../components/ui/button.js';
import { AcceptDialog } from '../detail/accept-dialog.js';
import { Composer } from '../detail/composer.js';
import { DocPane } from '../detail/docpane.js';
import { Segments, TodoGlanceContext, TodoStatus } from '../detail/segments.js';
import { SourceIssueLine } from '../detail/source-issue.js';
import { SpecBlock } from '../detail/spec-block.js';
import { StopConfirmDialog } from '../detail/stop-confirm-dialog.js';
import { WorkTrace } from '../detail/work-trace.js';
import { useI18n } from '../i18n/provider.js';
import { serializeMention } from '../overlay/mention-token.js';
import type { DocView } from '../overlay/plan-dropdown.js';
import { PHASE_UI } from '../phase.js';
import {
  CHANGES,
  MENTION_GROUPS,
  NOW,
  PLAN_DOC,
  sharedTodo,
  TRANSCRIPT_WORK,
} from './product-fixtures.js';
import { Cell, Labeled, Section, Specimen } from './specimen.js';

const READ_ONLY_REASON = '此任务为只读，请在实时工作区中打开后继续。';

const MENTION_DRAFT = `Use ${serializeMention({ kind: 'skill', id: 'frontend-design', label: 'frontend-design' })} and ask ${serializeMention({ kind: 'agent', id: 'reviewer', label: 'reviewer' })} to check ${serializeMention({ kind: 'todo', id: 'gallery-44', label: 'Fix the stale branch badge', seq: 44 })}`;

const TILE_IMAGE = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="112" height="112"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c5cff"/><stop offset="1" stop-color="#2fd4a7"/></linearGradient></defs><rect width="112" height="112" fill="url(#g)"/></svg>',
)}`;

const ATTACHED_DRAFT = [
  '![error.log](attachment:team-1/error.log)',
  '![crash-report.pdf](attachment:team-1/crash-report.pdf)',
  'Why does this crash on start?',
].join('\n');

const noop = () => {};

function ComposerSpecimen() {
  const [sent, setSent] = useState<string[]>([]);
  return (
    <Specimen
      id="composer"
      title="Composer"
      note={sent.length === 0 ? 'Type / for commands or @ for mentions' : `Sent: ${sent.at(-1)}`}
      stage="canvas"
      className="flex-col gap-y-10"
    >
      <Cell label="Empty: placeholder, attach, Review; send is muted until there is something to send">
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
      <Cell label="Typing: send turns ink (focus only darkens the ring)">
        <div className="w-160 pt-2">
          <Composer
            placeholder={PHASE_UI.review.placeholder ?? ''}
            aiReview
            streaming={false}
            editable
            draft="Why does this crash on start?"
            onDraftChange={noop}
            onReview={noop}
            onAttachment={(files) => files.map((f) => f.name)}
          />
        </div>
      </Cell>
      <Cell label="With attachments: two files from the draft, tiles sit above the text">
        <div className="w-160 pt-2">
          <Composer
            placeholder={PHASE_UI.review.placeholder ?? ''}
            aiReview={false}
            streaming={false}
            editable
            draft={ATTACHED_DRAFT}
            onDraftChange={noop}
            onAttachment={(files) => files.map((f) => f.name)}
          />
        </div>
      </Cell>
      <Cell label="Attachment tile states: file, image, uploading, upload failed">
        <div className="flex w-160 flex-wrap gap-2 rounded-(--radius-composer) bg-card px-3.5 pt-3.5 pb-3 shadow-(--shadow-composer)">
          <ComposerAttachmentTile
            name="error.log"
            kind="LOG"
            state="ready"
            href="#"
            onRemove={noop}
          />
          <ComposerAttachmentTile
            name="screenshot.png"
            kind="PNG"
            state="ready"
            imageSrc={TILE_IMAGE}
            onPreview={noop}
            onRemove={noop}
          />
          <ComposerAttachmentTile name="screen-recording.mov" kind="MOV" state="uploading" />
          <ComposerAttachmentTile
            name="build.zip"
            kind="ZIP"
            state="error"
            errorReason="Over 50 MB"
            onRemove={noop}
          />
        </div>
      </Cell>
      <Cell label="Agent running: timer and stop beside send; sending queues the message">
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
      <Cell label="Draft with @mentions highlighted inline in the text">
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
      <Cell label="Read only: secondary background, no tools, one sentence on how to continue">
        <div className="w-160">
          <Composer placeholder={READ_ONLY_REASON} aiReview={false} streaming={false} readOnly />
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
      <div className="flex w-120 flex-none flex-col shadow-[inset_1px_0_0_var(--border)]">
        <DocPane
          mode={view}
          doc={PLAN_DOC}
          changes={CHANGES}
          now={NOW}
          onDocView={setView}
          planVersions={[
            { v: 'v2', at: NOW - 600_000 },
            { v: 'v1', at: NOW - 3_600_000 },
          ]}
        />
      </div>
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
    ['stop', 'Stop'],
    ['stop-queued', 'Stop, queued'],
  ] as const;
  return (
    <Specimen
      id="task-dialogs"
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
        rejectReason="The PR still has a failing check."
      />
      <AcceptDialog
        open={open === 'accept-info'}
        onClose={close}
        onConfirm={() => done('accept')}
        infoOutput
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

const TASK_REF_TITLE = 'Read the cairn repo';
const TASK_REF_PHASES = ['building', 'review', 'done', 'failed', 'todo'] as const;

export function ProductDetailSection() {
  const { t } = useI18n();
  const [queued, setQueued] = useState([
    { id: 'q1', content: 'Also cover the done column.' },
    { id: 'q2', content: 'And keep the scroll position per project.', error: 'Delivery failed' },
    {
      id: 'q3',
      content:
        'Also, when you are done, summarise the change in two lines and list every file you touched so the review is quick.',
    },
  ]);
  const [last, setLast] = useState<string | null>(null);
  const settle = (what: string) => {
    setLast(what);
    return Promise.resolve();
  };
  return (
    <Section
      id="product-detail"
      title="Thread parts"
      lede="Pieces a thread conversation is built from: the spec, work traces, queued messages, the composer, the plan and changes pane and the finish and stop dialogs. The side chat composes them on the home."
    >
      <Specimen id="spec" title="Spec" note="SpecBlock" stage="sheet">
        <Cell label="SpecBlock">
          <div className="w-120">
            <SpecBlock
              spec={
                'Cards should show the branch of the **latest build**.\n\n- Keep the badge hidden while building\n- Cover the done column'
              }
            />
          </div>
        </Cell>
      </Specimen>
      <Specimen
        id="source-line"
        title="Source line"
        note="SourceIssueLine for each source kind"
        stage="sheet"
        className="flex-col"
      >
        <Cell label="From a Coordinator orchestration">
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
      <Specimen
        id="work-trace"
        title="Work trace"
        note="WorkTrace collapsed and expanded"
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
      </Specimen>
      <Specimen
        id="queued-messages"
        title="Queued messages"
        note={
          last ??
          'Capsules inside the composer: click one to edit it in place, send it now or remove it; a failed one offers Retry'
        }
        stage="canvas"
      >
        <div className="w-160 pt-2">
          <Composer
            placeholder={PHASE_UI.building.placeholder ?? ''}
            aiReview={false}
            streaming
            editable
            queuedMessages={queued}
            onSendQueuedNow={(id) => settle(`send now ${id}`)}
            onRemoveQueued={(id) => {
              setQueued((all) => all.filter((m) => m.id !== id));
              return settle(`remove ${id}`);
            }}
            onEditQueued={(id, content) => {
              setQueued((all) => all.map((m) => (m.id === id ? { ...m, content } : m)));
              return settle(`edit ${id}`);
            }}
          />
        </div>
      </Specimen>
      <ComposerSpecimen />
      <Specimen
        id="status-and-inline-segments"
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
        id="task-references"
        title="Task references"
        note="Reference row above a Coordinator reply and the inline chip, per task state: a tinted tile or pill, the status word only while working"
        className="flex-col items-start"
      >
        {TASK_REF_PHASES.map((phase) => (
          <Cell key={phase} label={phase}>
            <TodoGlanceContext.Provider
              value={new Map([[`gallery-ref-${phase}`, { phase, seq: 12, title: TASK_REF_TITLE }]])}
            >
              <div className="flex w-110 flex-col gap-1">
                <TaskRefRow
                  taskRef={{
                    todoId: `gallery-ref-${phase}`,
                    seq: 12,
                    title: TASK_REF_TITLE,
                    phase,
                  }}
                />
                <p className="m-0 text-ui leading-[22px]">
                  <Segments
                    codeClassName="chat-code"
                    segments={[
                      { text: 'Added the repository, and the test task ' },
                      {
                        text: TASK_REF_TITLE,
                        style: 'mention',
                        mentionKind: 'todo',
                        mentionId: `gallery-ref-${phase}`,
                      },
                      { text: ' is set up and reading it now.' },
                    ]}
                  />
                </p>
              </div>
            </TodoGlanceContext.Provider>
          </Cell>
        ))}
      </Specimen>
      <Specimen
        id="plan-and-changes"
        title="Plan and changes"
        note="DocPane, as the project page hosts it. Switch plan and changes from the pane title or header buttons."
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
