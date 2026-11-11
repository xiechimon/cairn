import type { AskUserAnswer } from '@cairn/shared';
import { cn } from 'cn';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Fragment,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { FORM_CONTROL_CLS } from '../components/form-layout.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';
import { toastSuccess } from '../components/ui/toaster.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { REPLY_BUBBLE_CLS } from '../detail/chat-markdown.js';
import type { ChiefStreamItem } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { MessageToolbar } from './message-toolbar.js';
import { answerKeyOf, questionDockState } from './question-dock-state.js';
import {
  applyQuestionPick,
  emptyQuestionDrafts,
  type QuestionDraft,
  questionDraftComplete,
  questionDraftStore,
  questionSubmitStore,
  replaceQuestionDraft,
} from './question-drafts.js';
import { REPLY_CHIP_CLS } from './quick-replies.js';

export type ChiefQuestionItem = Extract<ChiefStreamItem, { kind: 'question' }>;

export interface QuestionChipsProps {
  item: ChiefQuestionItem;
  onAnswer?: (input: { requestId: string; answers: AskUserAnswer[] }) => void;
  onCancel?: (requestId: string) => void;
  numberKeys?: boolean;
  draftKey?: string;
  pager?: QuestionPager;
  bound?: boolean;
}

export interface QuestionPager {
  label: string;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}

const PICKED_CHIP_CLS =
  'aria-pressed:bg-(--menu-hover) aria-pressed:border-(--text-tertiary) dark:aria-pressed:bg-(--menu-hover)';
const RECOMMENDED_CHIP_CLS = 'border-transparent bg-(--menu-hover) dark:bg-(--menu-hover)';

type Question = ChiefQuestionItem['questions'][number];

function digitsReachChips(target: HTMLElement): boolean {
  if (target.isContentEditable) return false;
  if (target instanceof HTMLTextAreaElement && target.hasAttribute('data-compose-target'))
    return target.hasAttribute('data-question-answer') && target.value === '';
  return !/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

export function recommendedFirst(question: Question): Question {
  return {
    ...question,
    options: [
      ...question.options.filter((option) => option.recommended === true),
      ...question.options.filter((option) => option.recommended !== true),
    ],
  };
}

function useQuestionDrafts(item: ChiefQuestionItem, questions: Question[], draftKey?: string) {
  const stored = useSyncExternalStore(
    questionDraftStore.subscribe,
    () => {
      if (draftKey === undefined) return null;
      const record = questionDraftStore.get(draftKey);
      return record !== undefined && record.drafts.length === questions.length ? record : null;
    },
    () => null,
  );
  const [local, setLocal] = useState(() => ({ drafts: emptyQuestionDrafts(questions), step: 0 }));
  const drafts = stored?.drafts ?? local.drafts;
  const step = stored?.step ?? local.step;
  useEffect(() => {
    if (draftKey !== undefined && item.status !== 'pending') questionDraftStore.clear(draftKey);
  }, [draftKey, item.status]);
  const commit = (nextDrafts: QuestionDraft[], nextStep: number) => {
    if (draftKey !== undefined)
      questionDraftStore.set(draftKey, { drafts: nextDrafts, step: nextStep });
    else setLocal({ drafts: nextDrafts, step: nextStep });
  };
  return { drafts, step, commit };
}

function ChipTip({ tip, children }: { tip: ReactNode; children: React.ReactElement }) {
  if (tip === null) return children;
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="top" sideOffset={6} className="max-w-72">
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}

export function QuestionChips({
  item,
  onAnswer,
  onCancel,
  numberKeys = false,
  draftKey,
  pager,
  bound = false,
}: QuestionChipsProps) {
  const { t } = useI18n();
  const questions = useMemo(() => item.questions.map(recommendedFirst), [item.questions]);
  const { drafts, step, commit } = useQuestionDrafts(item, questions, draftKey);
  const submitting = useSyncExternalStore(
    questionDraftStore.subscribe,
    () => (draftKey === undefined ? false : questionSubmitStore.get(draftKey).submitting),
    () => false,
  );
  const pending = item.status === 'pending' && onAnswer !== undefined && !submitting;
  const total = questions.length;
  const lastStep = total - 1;
  const last = step === lastStep;
  const question = questions[step] ?? questions[0];
  const draft = drafts[step];
  const blockRef = useRef<HTMLDivElement | null>(null);
  const baseId = useId();
  useSyncExternalStore(questionDockState.subscribe, questionDockState.snapshot, () => 0);

  const [localTexts, setLocalTexts] = useState<Record<number, string>>({});
  const textAt = (index: number): string =>
    draftKey !== undefined
      ? questionDockState.answerText(answerKeyOf(draftKey, index))
      : (localTexts[index] ?? '');
  const setTextAt = (index: number, text: string) => {
    if (draftKey !== undefined) questionDockState.setAnswerText(answerKeyOf(draftKey, index), text);
    else setLocalTexts((prev) => ({ ...prev, [index]: text }));
  };
  const withText = (
    stored: QuestionDraft | undefined,
    prompt: Question | undefined,
    text: string,
  ): QuestionDraft | undefined => {
    if (stored === undefined || prompt === undefined) return stored;
    if (stored.kind === 'text') return { kind: 'text', value: text };
    if (!bound || text.trim() === '') return stored;
    if (prompt.multiSelect === true) return { ...stored, other: true, otherText: text };
    return { kind: 'choices', picked: [], other: true, otherText: text };
  };
  const effectiveOf = (source: QuestionDraft[]) =>
    source.map((stored, index) => withText(stored, questions[index], textAt(index)) ?? stored);
  const effectiveDrafts = effectiveOf(drafts);
  const stepComplete = questionDraftComplete(effectiveDrafts[step], question);
  const completeIn = (source: QuestionDraft[]) =>
    pending && questions.every((q, i) => questionDraftComplete(source[i], q));
  const allComplete = completeIn(effectiveDrafts);

  const submitWith = (source: QuestionDraft[]) => {
    if (!completeIn(source)) return;
    if (draftKey !== undefined && questionSubmitStore.get(draftKey).submitting) return;
    onAnswer?.({
      requestId: item.requestId,
      answers: source.map((d, i) => {
        const header = questions[i]?.header ?? '';
        if (d.kind === 'text') return { header, text: d.value.trim() };
        const choices = [...d.picked];
        if (d.other && d.otherText.trim() !== '') choices.push(d.otherText.trim());
        return { header, choices };
      }),
    });
  };

  const blockedByUpload = bound && questionDockState.uploading();
  const canAdvance = pending && (last ? allComplete : stepComplete) && !blockedByUpload;
  const advance = () => {
    if (!canAdvance || (bound && questionDockState.uploading())) return;
    if (last) {
      submitWith(effectiveDrafts);
      return;
    }
    commit(drafts, Math.min(lastStep, step + 1));
  };
  const advanceRef = useRef(advance);
  advanceRef.current = advance;
  const dismissRef = useRef<(() => void) | null>(null);
  dismissRef.current =
    pending && onCancel !== undefined
      ? () =>
          questionDockState.dismissWithUndo(
            item.requestId,
            { title: t('已取消提问'), undo: t('撤销') },
            () => onCancel(item.requestId),
          )
      : null;

  const choose = (optionIndex: number) => {
    if (question === undefined || !pending || blockedByUpload) return;
    const picked = applyQuestionPick(drafts, step, question, optionIndex);
    if (question.multiSelect === true) {
      commit(picked, step);
      return;
    }
    setTextAt(step, '');
    if (!last) {
      commit(picked, step + 1);
      return;
    }
    commit(picked, step);
    submitWith(
      picked.map((stored, index) => (index === step ? stored : (effectiveDrafts[index] ?? stored))),
    );
  };

  useLayoutEffect(() => {
    if (!pending || question === undefined || question.options.length === 0) return;
    const max = question.options.length;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing || e.keyCode === 229) return;
      const block = blockRef.current;
      if (block?.checkVisibility() !== true) return;
      const target = e.target;
      if (!(target instanceof HTMLElement) || !digitsReachChips(target)) return;
      const inBlock = block.contains(target);
      const inAnswer = bound && target.hasAttribute('data-question-answer');
      if (!inBlock && !inAnswer && !numberKeys) return;
      if (
        !inBlock &&
        target.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')
      )
        return;
      if (!/^[1-9]$/.test(e.key)) return;
      const n = Number(e.key);
      if (n > max) return;
      e.preventDefault();
      if (e.repeat) return;
      if (question.multiSelect !== true) setTextAt(step, '');
      commit(applyQuestionPick(drafts, step, question, n - 1), step);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [pending, numberKeys, bound, step, question, drafts]);

  const typedText = textAt(step);
  const typedPicks = draft?.kind === 'choices' ? draft.picked.length : 0;
  useEffect(() => {
    if (!bound || !pending || question === undefined || question.multiSelect === true) return;
    if (typedText.trim() === '' || typedPicks === 0) return;
    const current = drafts[step];
    if (current?.kind !== 'choices') return;
    commit(replaceQuestionDraft(drafts, step, { ...current, picked: [] }), step);
  }, [typedText, typedPicks, bound, pending, step]);

  useEffect(() => {
    if (draftKey !== undefined && item.status !== 'pending')
      questionDockState.clearAnswers(draftKey);
  }, [draftKey, item.status]);

  useEffect(() => {
    if (!pending || !bound) {
      questionDockState.clearPrimary(item.requestId);
      return;
    }
    questionDockState.setPrimary({
      requestId: item.requestId,
      last,
      enabled: canAdvance,
      advance: () => advanceRef.current(),
    });
  }, [pending, bound, item.requestId, last, canAdvance]);
  useEffect(() => () => questionDockState.clearPrimary(item.requestId), [item.requestId]);

  useEffect(() => {
    const node = blockRef.current;
    if (node === null) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (dismissRef.current === null) return;
        event.preventDefault();
        dismissRef.current();
        return;
      }
      if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      advanceRef.current();
    };
    node.addEventListener('keydown', handler);
    return () => node.removeEventListener('keydown', handler);
  }, [item.status]);

  if (question === undefined || item.status !== 'pending') return null;

  const multi = question.multiSelect === true;
  const shownPager: QuestionPager | undefined =
    pager ??
    (total > 1
      ? {
          label: t('{n} / {total}', { n: step + 1, total }),
          canPrev: step > 0,
          canNext: !last && stepComplete,
          onPrev: () => commit(drafts, Math.max(0, step - 1)),
          onNext: () => commit(drafts, Math.min(lastStep, step + 1)),
        }
      : undefined);
  const dismiss = () =>
    questionDockState.dismissWithUndo(
      item.requestId,
      { title: t('已取消提问'), undo: t('撤销') },
      () => onCancel?.(item.requestId),
    );
  const copyText = (text: string) => {
    void navigator.clipboard?.writeText(text).then(
      () => toastSuccess(t('已复制')),
      () => {},
    );
  };
  const taskRef = /#\d+/.exec(question.header)?.[0];
  const showHeader =
    shownPager !== undefined || (taskRef !== undefined && !question.question.includes(taskRef));
  const showSubmitChip = multi || (question.options.length === 0 && !bound);

  return (
    <div
      ref={blockRef}
      data-testid="chief-question-chips"
      data-status={item.status}
      data-request-id={item.requestId}
      className="flex min-w-0 flex-col items-start gap-1"
    >
      {showHeader && (
        <div className="flex max-w-full min-w-0 items-center gap-1 text-caption text-(--text-tertiary)">
          <span data-testid="chief-question-header" className="min-w-0 truncate">
            {question.header}
          </span>
          {shownPager !== undefined && (
            <span
              className="flex flex-none items-center"
              title={blockedByUpload ? t('附件上传中') : undefined}
            >
              <IconTooltip
                label={t('上一步')}
                trigger={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    data-testid="chief-question-prev"
                    disabled={!pending || !shownPager.canPrev}
                    onClick={shownPager.onPrev}
                  />
                }
              >
                <ChevronLeft aria-hidden className="size-4" />
              </IconTooltip>
              <span data-testid="chief-question-position" className="tabular-nums">
                {shownPager.label}
              </span>
              <IconTooltip
                label={t('下一步')}
                trigger={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    data-testid="chief-question-next"
                    disabled={!pending || !shownPager.canNext}
                    onClick={shownPager.onNext}
                  />
                }
              >
                <ChevronRight aria-hidden className="size-4" />
              </IconTooltip>
            </span>
          )}
        </div>
      )}
      <div
        data-tools-root=""
        className="group/message flex max-w-full min-w-0 flex-col items-start"
      >
        <div className="group/reply-block relative w-fit max-w-full" data-slot="reply-block">
          <div
            data-testid="chief-question-text"
            className={cn(REPLY_BUBBLE_CLS, 'text-ui leading-5 break-words')}
          >
            {question.question}
          </div>
          <MessageToolbar
            placement="right"
            testId="chief-question-tools"
            stamp={null}
            onCopy={() => copyText(question.question)}
            onDismiss={pending && onCancel !== undefined ? dismiss : undefined}
          />
        </div>
        <MessageToolbar
          placement="below-start"
          testId="chief-question-tools-touch"
          stamp={null}
          onCopy={() => copyText(question.question)}
          onDismiss={pending && onCancel !== undefined ? dismiss : undefined}
        />
      </div>
      <fieldset
        aria-label={t('回答选项')}
        className="m-0 mt-3 flex max-w-full min-w-0 flex-wrap items-center gap-3 border-0 p-0"
      >
        {question.options.map((option, oi) => {
          const selected = draft?.kind === 'choices' && draft.picked.includes(option.label);
          const description =
            option.description !== undefined && option.description !== ''
              ? option.description
              : null;
          const recommended = option.recommended === true;
          const tipText = [recommended ? t('推荐') : null, description]
            .filter((part) => part !== null)
            .join(' · ');
          const tip =
            tipText === '' && oi >= 9 ? null : (
              <span className="flex items-center gap-2">
                <span>{tipText === '' ? option.label : tipText}</span>
                {oi < 9 && (
                  <kbd className="font-sans text-(--text-tertiary) tabular-nums">{oi + 1}</kbd>
                )}
              </span>
            );
          const describedBy = tipText === '' ? undefined : `${baseId}-o${oi}`;
          return (
            <Fragment key={oi}>
              {describedBy !== undefined && (
                <span id={describedBy} hidden>
                  {tipText}
                </span>
              )}
              <ChipTip tip={tip}>
                <Button
                  variant="ghost"
                  data-testid={`chief-question-option-${step}-${oi}`}
                  disabled={!pending || blockedByUpload}
                  aria-pressed={selected}
                  aria-describedby={describedBy}
                  data-recommended={recommended ? '' : undefined}
                  className={cn(
                    REPLY_CHIP_CLS,
                    PICKED_CHIP_CLS,
                    recommended && RECOMMENDED_CHIP_CLS,
                    'gap-1.5',
                  )}
                  onClick={() => choose(oi)}
                >
                  {multi && selected && <Check aria-hidden className="size-4" />}
                  <span>{option.label}</span>
                </Button>
              </ChipTip>
            </Fragment>
          );
        })}
        {question.options.length === 0 && !bound && (
          <Input
            data-testid={`chief-question-input-${step}`}
            className={cn(FORM_CONTROL_CLS, 'h-7 w-64 max-w-full rounded-full')}
            placeholder={t('输入你的回答')}
            value={textAt(step)}
            disabled={!pending}
            onChange={(e) => setTextAt(step, e.target.value)}
          />
        )}
        {showSubmitChip && (
          <Button
            variant="ghost"
            data-testid="chief-question-submit"
            disabled={!canAdvance}
            className={REPLY_CHIP_CLS}
            onClick={advance}
          >
            {last ? t('提交') : t('下一步')}
          </Button>
        )}
      </fieldset>
    </div>
  );
}
