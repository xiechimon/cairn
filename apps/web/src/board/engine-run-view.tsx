import { cn } from 'cn';
import { useLayoutEffect, useRef, useState } from 'react';
import { REPLY_CHIP_CLS } from '../chief/quick-replies.js';
import { TraceOutput } from '../components/chat/trace-parts.js';
import { Button } from '../components/ui/button.js';
import {
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DialogShell,
} from '../components/ui/dialog-shell.js';
import { REPLY_BUBBLE_CLS } from '../detail/chat-markdown.js';
import { useScrollFade } from '../hooks/use-scroll-fade.js';
import { useI18n } from '../i18n/provider.js';
import {
  type EngineRun,
  type EngineRunActions,
  engineCanTakeOver,
  enginePendingQuestion,
} from './engine-run.js';

const END_SLACK = 24;
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

const TAIL_LINK =
  'h-6 min-h-0 flex-none rounded-(--radius-control) px-1.5 text-meta font-normal text-(--text-secondary)';

export function EngineRunTail({
  run,
  actions,
  onViewRaw,
}: {
  run: EngineRun;
  actions?: EngineRunActions;
  onViewRaw: () => void;
}) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
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
      <div
        data-testid="engine-tail"
        data-state={run.state}
        className="mt-4 flex min-w-0 items-center text-meta leading-5"
      >
        <span className="-ml-1.5 flex flex-none items-center">
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
      <TakeOverDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => actions?.takeOver()}
      />
    </>
  );
}
