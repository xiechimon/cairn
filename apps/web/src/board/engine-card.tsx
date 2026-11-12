import { cn } from 'cn';
import { ChevronRight } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { REPLY_CHIP_CLS } from '../chief/quick-replies.js';
import { TypingDots } from '../components/chat/live-row.js';
import {
  TraceCard,
  TraceCommandBox,
  TraceOutput,
  TraceRowButton,
} from '../components/chat/trace-parts.js';
import { TraceStepRow } from '../components/chat/trace-steps.js';
import { SegmentedTabs } from '../components/segmented.js';
import { Button } from '../components/ui/button.js';
import {
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DialogShell,
} from '../components/ui/dialog-shell.js';
import { ChatMarkdown, REPLY_BUBBLE_CLS, TaskCard } from '../detail/chat-markdown.js';
import { DiffFileBlock } from '../detail/docpane.js';
import { formatWorkDuration } from '../detail/work-trace.js';
import { useScrollFade } from '../hooks/use-scroll-fade.js';
import { useI18n } from '../i18n/provider.js';
import {
  ENGINE_CHOICE_WORDS,
  ENGINE_STATE_WORDS,
  type EngineEvent,
  type EngineRun,
  type EngineRunActions,
  type EngineRunState,
  engineCanTakeOver,
  engineCost,
  engineEarlierCount,
  enginePendingQuestion,
  enginePlanItems,
  engineTraceStep,
} from './engine-run.js';
import { joinMeta } from './rel-time.js';

type EngineView = 'chat' | 'raw';

const STATE_DOT: Record<EngineRunState, string> = {
  running: 'bg-running',
  waiting: 'bg-(--badge-attention)',
  finished: 'bg-(--text-tertiary)',
  failed: 'bg-destructive',
  taken_over: 'bg-foreground',
};

const BLOCK = 'px-3 py-2.5';
const END_SLACK = 24;
const HEAD_LINK =
  'h-6 min-h-0 flex-none rounded-(--radius-control) px-2 text-meta font-normal text-foreground';

const KEYBOARD_SCROLLABLE = { tabIndex: 0 } as const;

function useStickToEnd<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const pinned = useRef(true);
  useScrollFade(ref);
  useLayoutEffect(() => {
    const el = ref.current;
    const content = el?.firstElementChild;
    if (el == null || content == null) return;
    const stick = () => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
    };
    stick();
    const observer = new ResizeObserver(stick);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  const onScroll = () => {
    const el = ref.current;
    if (el !== null) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < END_SLACK;
  };
  return { ref, onScroll, ...KEYBOARD_SCROLLABLE };
}

function EditRow({ event }: { event: Extract<EngineEvent, { kind: 'edit' }> }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const { file } = event;
  return (
    <div data-testid="engine-edit">
      <TraceRowButton
        verb={t('修改了')}
        target={file.path}
        expandable
        open={open}
        onClick={() => setOpen((value) => !value)}
        trailing={
          <span className="flex gap-1 font-mono text-code">
            <span className="text-(--diff-add-fg)">+{file.added}</span>
            <span className="text-destructive">−{file.removed ?? 0}</span>
          </span>
        }
      />
      {open && (
        <div
          {...KEYBOARD_SCROLLABLE}
          className="overflow-x-auto border-t border-(--border)"
          data-testid="engine-diff"
        >
          <div className="w-max min-w-full">
            <DiffFileBlock
              file={file}
              expanded
              buildId={null}
              allowFullFile={false}
              fileRow={false}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function UnknownRow({ event }: { event: Extract<EngineEvent, { kind: 'unknown' }> }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div data-testid="engine-unknown">
      <TraceRowButton
        verb={t('未识别的事件')}
        target={event.type}
        mono
        expandable
        open={open}
        onClick={() => setOpen((value) => !value)}
      />
      {open && (
        <div className="px-3 pb-3" data-testid="engine-unknown-payload">
          <TraceCommandBox prompt={false} command={event.payload} />
        </div>
      )}
    </div>
  );
}

function QuestionBlock({
  event,
  actions,
  onTakeOver,
}: {
  event: Extract<EngineEvent, { kind: 'question' }>;
  actions: EngineRunActions | undefined;
  onTakeOver: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      data-testid="engine-question"
      data-answer={event.answer ?? 'pending'}
      className={cn(BLOCK, 'flex flex-col gap-2.5')}
    >
      <p className="m-0 text-ui leading-5 text-foreground">{event.text}</p>
      {event.answer !== null ? (
        <p className="m-0 text-meta text-(--text-tertiary)">
          {t(event.answer === 'allowed' ? '已允许这一次' : '已拒绝')}
        </p>
      ) : (
        actions !== undefined && (
          <fieldset
            aria-label={t('回答引擎')}
            className="m-0 flex min-w-0 flex-wrap gap-3 border-0 p-0 pb-0.5"
          >
            <Button
              variant="ghost"
              className={REPLY_CHIP_CLS}
              onClick={() => actions.answer(event.id, 'allowed')}
            >
              {t('允许这一次')}
            </Button>
            <Button
              variant="ghost"
              className={REPLY_CHIP_CLS}
              onClick={() => actions.answer(event.id, 'refused')}
            >
              {t('拒绝')}
            </Button>
            <Button variant="ghost" className={REPLY_CHIP_CLS} onClick={onTakeOver}>
              {t('接管')}
            </Button>
          </fieldset>
        )
      )}
    </div>
  );
}

function EventBlock({
  event,
  actions,
  onTakeOver,
}: {
  event: EngineEvent;
  actions: EngineRunActions | undefined;
  onTakeOver: () => void;
}) {
  switch (event.kind) {
    case 'text':
      return (
        <div
          data-testid="engine-text"
          className={cn(BLOCK, 'text-ui leading-5 break-words text-foreground')}
        >
          <ChatMarkdown text={event.text} />
        </div>
      );
    case 'read':
      return <TraceStepRow step={engineTraceStep(event)} />;
    case 'run':
      return (
        <TraceStepRow
          key={event.exit === null ? 'running' : 'settled'}
          step={engineTraceStep(event)}
        />
      );
    case 'edit':
      return <EditRow event={event} />;
    case 'unknown':
      return <UnknownRow event={event} />;
    case 'question':
      return <QuestionBlock event={event} actions={actions} onTakeOver={onTakeOver} />;
  }
}

function Conversation({
  run,
  actions,
  onTakeOver,
}: {
  run: EngineRun;
  actions: EngineRunActions | undefined;
  onTakeOver: () => void;
}) {
  const { t } = useI18n();
  const [showsEarlier, setShowsEarlier] = useState(false);
  const earlier = engineEarlierCount(run.events.length);
  const events = showsEarlier ? run.events : run.events.slice(earlier);
  return (
    <>
      {run.plan.length > 0 && (
        <div data-testid="engine-plan" className="px-3 py-3">
          <TaskCard bare items={enginePlanItems(run.plan)} />
        </div>
      )}
      <div
        role="log"
        aria-label={t('引擎事件')}
        data-testid="engine-events"
        className="divide-y divide-(--border)"
      >
        {earlier > 0 && (
          <TraceRowButton
            data-testid="engine-earlier"
            verb={t(showsEarlier ? '收起之前的 {n} 步' : '之前的 {n} 步', { n: earlier })}
            expandable
            open={showsEarlier}
            onClick={() => setShowsEarlier((value) => !value)}
          />
        )}
        {events.map((event) => (
          <EventBlock
            key={event.id}
            event={event}
            actions={run.state === 'taken_over' ? undefined : actions}
            onTakeOver={onTakeOver}
          />
        ))}
        {run.state === 'running' && (
          <div className={cn(BLOCK, 'flex')}>
            <TypingDots testId="engine-typing" label={t('引擎正在运行')} />
          </div>
        )}
      </div>
    </>
  );
}

export function EngineRawView({ run }: { run: EngineRun }) {
  return (
    <div data-testid="engine-raw-view" className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <RawOutput text={run.rawOutput} fill />
    </div>
  );
}

function RawOutput({ text, fill = false }: { text: string; fill?: boolean }) {
  const { t } = useI18n();
  const scroller = useStickToEnd<HTMLPreElement>();
  return (
    <TraceOutput
      {...scroller}
      role="log"
      aria-label={t('原始输出')}
      data-testid="engine-raw"
      className={cn(
        'scroll-fade text-foreground',
        fill ? 'max-h-none min-h-0 flex-1 px-4 py-3' : 'max-h-96 px-3 py-3',
      )}
    >
      <span className="block">{text}</span>
    </TraceOutput>
  );
}

function TakeOverDialog({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  return (
    <DialogShell
      title={t('接管这次运行')}
      open={open}
      onClose={onClose}
      size="s"
      footer={
        <>
          <Button variant="ghost" className={DIALOG_TEXT_BUTTON} onClick={onClose}>
            {t('取消')}
          </Button>
          <Button
            className={DIALOG_PRIMARY_BUTTON}
            data-testid="engine-take-over-confirm"
            onClick={() => {
              onClose();
              onConfirm();
            }}
          >
            {t('接管')}
          </Button>
        </>
      }
    >
      <p className="m-0 text-ui text-foreground">
        {t('终端接入后，接管会让引擎停下，把它的终端交给你直接操作；交还后它从你停下的地方继续。')}
      </p>
      <p className="m-0 mt-2 text-ui text-(--text-secondary)">
        {t('终端还没有接入：现在接管只把这次运行标记为由你处理，随时可以交还。')}
      </p>
    </DialogShell>
  );
}

const ROW_DOT: Record<EngineRunState, string> = STATE_DOT;

export function EngineRunRow({ run, onOpen }: { run: EngineRun; onOpen: () => void }) {
  const { t } = useI18n();
  const doing = run.plan.find((step) => step.state === 'doing');
  const detail =
    run.state === 'running' || run.state === 'taken_over'
      ? (doing?.text ?? null)
      : run.elapsedSeconds === null
        ? null
        : formatWorkDuration(run.elapsedSeconds);
  return (
    <TraceCard className="mt-5 w-fit max-w-full">
      <Button
        variant="ghost"
        data-testid="engine-row"
        data-state={run.state}
        aria-description={t('查看运行过程')}
        onClick={onOpen}
        className="h-10 max-w-full justify-start gap-2 border-0 px-3 text-ui font-normal text-foreground hover:bg-(--menu-hover) pointer-coarse:h-11 dark:hover:bg-(--menu-hover)"
      >
        <span
          aria-hidden="true"
          className={cn('size-1.5 flex-none rounded-full', ROW_DOT[run.state])}
        />
        <span className="flex-none">{run.engine}</span>
        <span className="flex-none text-(--text-secondary)">
          {t(ENGINE_STATE_WORDS[run.state])}
        </span>
        {detail !== null && (
          <span className="min-w-0 truncate text-meta text-content-tertiary">{detail}</span>
        )}
        <ChevronRight aria-hidden="true" className="size-4 flex-none text-(--text-tertiary)" />
      </Button>
    </TraceCard>
  );
}

const TAIL_LINK =
  'h-6 min-h-0 flex-none rounded-(--radius-control) px-1.5 text-meta font-normal text-(--text-secondary)';

export function EngineRunTail({
  run,
  actions,
  onViewRaw,
}: {
  run: EngineRun;
  actions?: EngineRunActions;
  onViewRaw?: () => void;
}) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const { choice } = run;
  const question = enginePendingQuestion(run);
  return (
    <>
      {question !== null && (
        <div data-testid="engine-question" data-answer="pending" className="mt-5">
          <div
            className={cn('w-fit max-w-full text-ui leading-5 text-foreground', REPLY_BUBBLE_CLS)}
          >
            {question.text}
          </div>
          {actions !== undefined && run.state !== 'taken_over' && (
            <fieldset
              aria-label={t('回答引擎')}
              className="m-0 mt-3 flex min-w-0 flex-wrap gap-3 border-0 p-0 pb-0.5"
            >
              <Button
                variant="ghost"
                className={REPLY_CHIP_CLS}
                onClick={() => actions.answer(question.id, 'allowed')}
              >
                {t('允许这一次')}
              </Button>
              <Button
                variant="ghost"
                className={REPLY_CHIP_CLS}
                onClick={() => actions.answer(question.id, 'refused')}
              >
                {t('拒绝')}
              </Button>
            </fieldset>
          )}
        </div>
      )}
      {onViewRaw !== undefined && (
        <div
          data-testid="engine-tail"
          data-state={run.state}
          className="mt-4 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-meta leading-5 text-content-tertiary"
        >
          <span data-testid="engine-choice" className="min-w-0">
            {joinMeta([
              run.elapsedSeconds === null ? null : formatWorkDuration(run.elapsedSeconds),
              engineCost(run.costUsd),
              t(ENGINE_CHOICE_WORDS.modelTier[choice.modelTier]),
              t(ENGINE_CHOICE_WORDS.effort[choice.effort]),
              choice.reason,
            ])}
          </span>
          <span className="flex flex-none items-center">
            <Button
              variant="ghost"
              data-testid="engine-view-raw"
              className={TAIL_LINK}
              onClick={onViewRaw}
            >
              {t('原始输出')}
            </Button>
            {actions !== undefined && run.state === 'taken_over' && (
              <Button
                variant="ghost"
                data-testid="engine-hand-back"
                className={TAIL_LINK}
                onClick={actions.handBack}
              >
                {t('交还')}
              </Button>
            )}
            {actions !== undefined && engineCanTakeOver(run.state) && (
              <Button
                variant="ghost"
                data-testid="engine-take-over"
                className={TAIL_LINK}
                onClick={() => setConfirming(true)}
              >
                {t('接管')}
              </Button>
            )}
          </span>
        </div>
      )}
      <TakeOverDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => actions?.takeOver()}
      />
    </>
  );
}

export function EngineCard({
  run,
  actions,
  className,
}: {
  run: EngineRun;
  actions?: EngineRunActions;
  className?: string;
}) {
  const { t } = useI18n();
  const [view, setView] = useState<EngineView>('chat');
  const [confirming, setConfirming] = useState(false);
  const { choice } = run;
  return (
    <>
      <TraceCard
        data-testid="engine-card"
        data-state={run.state}
        data-view={view}
        className={cn('mt-5', className)}
      >
        <div className="px-3 py-2.5">
          <div className="flex items-center gap-2">
            <div className="flex min-w-0 flex-auto items-center gap-2 text-ui leading-5">
              <span
                aria-hidden="true"
                data-slot="engine-dot"
                className={cn('size-1.5 flex-none rounded-full', STATE_DOT[run.state])}
              />
              <span className="truncate font-medium text-foreground">{run.engine}</span>
              <span
                data-testid="engine-state"
                className="flex-none whitespace-nowrap text-(--text-secondary)"
              >
                {t(ENGINE_STATE_WORDS[run.state])}
              </span>
            </div>
            <SegmentedTabs
              value={view}
              onChange={setView}
              label={t('引擎视图')}
              className="h-7 flex-none p-0.5 group-data-horizontal/tabs:h-7"
              optionHandle="h-6 px-2.5 text-foreground data-active:font-normal dark:text-foreground"
              options={[
                { value: 'chat', label: t('对话'), testId: 'engine-view-chat' },
                { value: 'raw', label: t('原始输出'), testId: 'engine-view-raw' },
              ]}
            />
          </div>
          <div className="mt-1.5 flex items-start gap-3">
            <p
              data-testid="engine-choice"
              className="m-0 min-w-0 flex-auto text-meta leading-5 text-content-tertiary"
            >
              {joinMeta([
                run.elapsedSeconds === null ? null : formatWorkDuration(run.elapsedSeconds),
                engineCost(run.costUsd),
                t(ENGINE_CHOICE_WORDS.modelTier[choice.modelTier]),
                t(ENGINE_CHOICE_WORDS.effort[choice.effort]),
                choice.reason,
              ])}
            </p>
            {actions !== undefined && run.state === 'taken_over' && (
              <Button
                variant="ghost"
                data-testid="engine-hand-back"
                className={HEAD_LINK}
                onClick={actions.handBack}
              >
                {t('交还')}
              </Button>
            )}
            {actions !== undefined && engineCanTakeOver(run.state) && (
              <Button
                variant="ghost"
                data-testid="engine-take-over"
                className={HEAD_LINK}
                onClick={() => setConfirming(true)}
              >
                {t('接管')}
              </Button>
            )}
          </div>
        </div>
        {view === 'chat' ? (
          <Conversation run={run} actions={actions} onTakeOver={() => setConfirming(true)} />
        ) : (
          <RawOutput text={run.rawOutput} />
        )}
      </TraceCard>
      <TakeOverDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => actions?.takeOver()}
      />
    </>
  );
}
