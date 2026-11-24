import type { AskUserAnswer } from '@cairn/shared';
import { cn } from 'cn';
import { ArrowUp, Check, ChevronDown, ChevronLeft, ChevronRight, Pencil } from 'lucide-react';
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { IconTooltip } from '../components/icon-tooltip.js';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';
import { ChatMarkdown } from '../detail/chat-markdown.js';
import { useI18n } from '../i18n/provider.js';
import { ApprovalCard } from './approval-card.js';
import { approvalCardOf, isApprovalRequest } from './approval-card-model.js';
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
import {
  type ChiefQuestionItem,
  type ChiefQuestionPrompt,
  recommendedFirst,
} from './question-item.js';

export interface DockPager {
  at: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}

export interface DecisionDockProps {
  item: ChiefQuestionItem;
  onAnswer?: (input: { requestId: string; answers: AskUserAnswer[] }) => void;
  onCancel?: (requestId: string) => void;
  onMinimize?: () => void;
  draftKey?: string;
  bound?: boolean;
  pager?: DockPager | null;
  footer?: ReactNode;
  enter?: boolean;
}

export const DOCK_CLS =
  'flex max-h-[min(60dvh,560px)] min-h-0 w-full flex-col overflow-hidden rounded-(--radius-composer) bg-popover shadow-[0_0_0_1px_var(--border),var(--composer-drop)] dark:bg-(--composer-fill) dark:shadow-(--composer-drop)';

const ICON_BTN_CLS =
  'size-6 rounded-md p-0 text-content-tertiary hover:bg-(--menu-hover) hover:text-foreground disabled:opacity-40 pointer-coarse:size-11';

const ROW_CLS =
  "relative grid min-h-10 w-full grid-cols-[24px_minmax(0,1fr)] items-center gap-x-3 rounded-lg p-2 text-left [&+&]:before:absolute [&+&]:before:inset-x-2 [&+&]:before:top-0 [&+&]:before:h-px [&+&]:before:bg-border [&+&]:before:content-[''] hover:before:opacity-0 [&:hover+&]:before:opacity-0 focus-within:before:opacity-0 [&:focus-within+&]:before:opacity-0 pointer-coarse:min-h-11";

const ROW_BUTTON_CLS =
  'h-auto cursor-pointer justify-items-stretch border-0 font-normal whitespace-normal select-auto hover:bg-(--menu-hover) disabled:cursor-default disabled:opacity-100 dark:hover:bg-(--menu-hover)';

const OTHER_INPUT_CLS =
  'h-6 border-0 bg-transparent p-0 text-ui text-foreground shadow-none placeholder:text-content-tertiary focus-visible:ring-0 disabled:bg-transparent disabled:opacity-100 md:text-ui dark:bg-transparent dark:disabled:bg-transparent';

const KEY_CLS =
  'grid size-6 place-items-center rounded-md bg-secondary text-meta text-content-tertiary tabular-nums';

const SKIP_CLS =
  'h-7 flex-none rounded-lg bg-secondary px-2.5 text-meta font-normal text-content-secondary hover:bg-secondary hover:text-foreground pointer-coarse:h-11';

const GO_CLS =
  'size-7 flex-none rounded-full bg-primary p-0 text-primary-foreground hover:bg-primary/90 disabled:bg-secondary disabled:text-content-tertiary disabled:opacity-100 pointer-coarse:size-11';

function useQuestionDrafts(
  item: ChiefQuestionItem,
  questions: ChiefQuestionPrompt[],
  draftKey?: string,
) {
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

function OptionLabel({
  label,
  description,
  recommended,
}: {
  label: string;
  description: string | null;
  recommended: boolean;
}) {
  const { t } = useI18n();
  return (
    <span className="flex min-w-0 flex-col">
      <span className="text-ui text-foreground wrap-anywhere">
        {label}
        {recommended && (
          <span
            data-testid="chief-question-recommended"
            className="ml-1.5 text-meta whitespace-nowrap text-content-tertiary"
          >
            {t('推荐')}
          </span>
        )}
      </span>
      {description !== null && (
        <span
          data-testid="chief-question-option-description"
          className="text-meta text-pretty text-content-tertiary wrap-anywhere"
        >
          {description}
        </span>
      )}
    </span>
  );
}

function CheckBox({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      data-slot="dock-check"
      className={cn(
        'm-1 grid size-4 place-items-center rounded-sm',
        on ? 'bg-primary text-primary-foreground' : 'shadow-[inset_0_0_0_1.5px_var(--input)]',
      )}
    >
      {on && <Check strokeWidth={1.75} className="size-4" />}
    </span>
  );
}

function DockTools({ pager, onMinimize }: { pager: DockPager | null; onMinimize?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="sticky top-0 flex h-6 flex-none items-center">
      {pager !== null && pager.total > 1 && (
        <>
          <IconTooltip
            label={t('上一个问题')}
            trigger={
              <Button
                variant="ghost"
                data-testid="chief-question-prev"
                aria-label={t('上一个问题')}
                disabled={pager.at === 0}
                className={ICON_BTN_CLS}
                onClick={pager.onPrev}
              />
            }
          >
            <ChevronLeft className="size-4" />
          </IconTooltip>
          <span
            data-testid="chief-question-pager"
            className="min-w-7 text-center text-meta text-content-tertiary tabular-nums"
          >
            {pager.at + 1}/{pager.total}
          </span>
          <IconTooltip
            label={t('下一个问题')}
            trigger={
              <Button
                variant="ghost"
                data-testid="chief-question-next"
                aria-label={t('下一个问题')}
                disabled={pager.at === pager.total - 1}
                className={ICON_BTN_CLS}
                onClick={pager.onNext}
              />
            }
          >
            <ChevronRight className="size-4" />
          </IconTooltip>
        </>
      )}
      {onMinimize !== undefined && (
        <IconTooltip
          label={t('收起')}
          trigger={
            <Button
              variant="ghost"
              data-testid="chief-question-minimize"
              aria-label={t('收起')}
              className={cn(ICON_BTN_CLS, 'ml-1')}
              onClick={onMinimize}
            />
          }
        >
          <ChevronDown className="size-4" />
        </IconTooltip>
      )}
    </div>
  );
}

function rowsOf(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[data-dock-row]')];
}

export function DecisionDock({
  item,
  onAnswer,
  onCancel,
  onMinimize,
  draftKey,
  bound = false,
  pager = null,
  footer,
  enter = false,
}: DecisionDockProps) {
  const { t } = useI18n();
  const questions = useMemo(() => item.questions.map(recommendedFirst), [item.questions]);
  const { drafts, step, commit } = useQuestionDrafts(item, questions, draftKey);
  const submitting = useSyncExternalStore(
    questionDraftStore.subscribe,
    () => (draftKey === undefined ? false : questionSubmitStore.get(draftKey).submitting),
    () => false,
  );
  const pending = item.status === 'pending' && onAnswer !== undefined && !submitting;
  const lastStep = questions.length - 1;
  const last = step === lastStep;
  const question = questions[step] ?? questions[0];
  const draft = drafts[step];
  const headId = useId();
  const listRef = useRef<HTMLFieldSetElement | null>(null);
  useSyncExternalStore(questionDockState.subscribe, questionDockState.snapshot, () => 0);

  const typedAt = (index: number): string =>
    draftKey === undefined ? '' : questionDockState.answerText(answerKeyOf(draftKey, index));
  const withTyped = (
    stored: QuestionDraft,
    prompt: ChiefQuestionPrompt | undefined,
    text: string,
  ) => {
    if (!bound || prompt === undefined || text.trim() === '') return stored;
    if (stored.kind === 'text') return { kind: 'text' as const, value: text };
    if (prompt.multiSelect === true) return { ...stored, other: true, otherText: text };
    return { kind: 'choices' as const, picked: [], other: true, otherText: text };
  };
  const effectiveOf = (source: QuestionDraft[]) =>
    source.map((stored, index) => withTyped(stored, questions[index], typedAt(index)));
  const effectiveDrafts = effectiveOf(drafts);
  const stepComplete = questionDraftComplete(effectiveDrafts[step], question);
  const completeIn = (source: QuestionDraft[]) =>
    pending && questions.every((q, i) => questionDraftComplete(source[i], q));
  const allComplete = completeIn(effectiveDrafts);
  const firstOpen = (source: QuestionDraft[]) =>
    questions.findIndex((q, i) => !questionDraftComplete(source[i], q));

  const submitWith = (source: QuestionDraft[]) => {
    if (draftKey !== undefined && questionSubmitStore.get(draftKey).submitting) return;
    if (!completeIn(source)) {
      const open = firstOpen(source);
      if (open >= 0) commit(source, open);
      return;
    }
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

  const choose = (optionIndex: number) => {
    if (question === undefined || !pending || blockedByUpload) return;
    const picked = applyQuestionPick(drafts, step, question, optionIndex);
    if (question.multiSelect === true) {
      commit(picked, step);
      return;
    }
    if (draftKey !== undefined) questionDockState.setAnswerText(answerKeyOf(draftKey, step), '');
    if (!last) {
      commit(picked, step + 1);
      return;
    }
    commit(picked, step);
    submitWith(
      picked.map((stored, index) => (index === step ? stored : (effectiveDrafts[index] ?? stored))),
    );
  };

  const otherText =
    draft === undefined ? '' : draft.kind === 'text' ? draft.value : draft.otherText;
  const setOther = (text: string) => {
    if (draft === undefined || question === undefined) return;
    if (draft.kind === 'text') {
      commit(replaceQuestionDraft(drafts, step, { kind: 'text', value: text }), step);
      return;
    }
    commit(
      replaceQuestionDraft(drafts, step, {
        kind: 'choices',
        picked: question.multiSelect === true ? draft.picked : [],
        other: text.trim() !== '',
        otherText: text,
      }),
      step,
    );
  };

  const skip = () => {
    if (!pending || onCancel === undefined) return;
    questionDockState.dismissWithUndo(
      item.requestId,
      { title: t('已跳过提问'), undo: t('撤销') },
      () => onCancel(item.requestId),
    );
  };

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

  if (question === undefined || item.status !== 'pending') return null;

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape' && onMinimize !== undefined) {
      event.preventDefault();
      onMinimize();
      return;
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      advanceRef.current();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const root = listRef.current;
    if (root === null) return;
    const rows = rowsOf(root);
    const target = event.target as HTMLElement;
    const at = rows.indexOf(target);
    const typing = target instanceof HTMLInputElement;
    if (!typing && /^[1-9]$/.test(event.key)) {
      const row = rows[Number(event.key) - 1];
      if (row === undefined) return;
      event.preventDefault();
      row.focus();
      return;
    }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && at >= 0) {
      event.preventDefault();
      rows[(at + (event.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length]?.focus();
    }
  };

  const approval = isApprovalRequest(item.requestId) ? approvalCardOf(question, t) : null;
  if (approval !== null) {
    const submittedIndex =
      submitting && draft?.kind === 'choices'
        ? question.options.findIndex((option) => option.label === draft.picked[0])
        : -1;
    return (
      <section
        data-testid="chief-question"
        data-request-id={item.requestId}
        aria-label={t('待回答的提问')}
        onKeyDown={onKeyDown}
        className="flex w-full min-w-0 flex-col items-stretch gap-1"
      >
        {(onMinimize !== undefined || (pager?.total ?? 0) > 1) && (
          <div className="flex justify-end">
            <DockTools pager={pager} onMinimize={onMinimize} />
          </div>
        )}
        <ApprovalCard
          card={approval}
          disabled={!pending || blockedByUpload}
          busy={submittedIndex < 0 ? null : `chief-question-option-${step}-${submittedIndex}`}
          actions={question.options.map((option, oi) => ({
            label: option.label,
            testId: `chief-question-option-${step}-${oi}`,
            onClick: () => choose(oi),
          }))}
        />
        {footer}
      </section>
    );
  }

  const multi = question.multiSelect === true;
  const typed = otherText.trim() !== '';
  const picked = draft?.kind === 'choices' ? draft.picked : [];
  const count = picked.length + (typed ? 1 : 0);
  const disabled = !pending || blockedByUpload;
  const submitLabel = last ? t('提交回答') : t('下一步');
  const go = (testId: string, enabled: boolean) => (
    <IconTooltip
      label={submitLabel}
      trigger={
        <Button
          variant="ghost"
          data-testid={testId}
          aria-label={submitLabel}
          disabled={!enabled}
          className={GO_CLS}
          onClick={advance}
        />
      }
    >
      <ArrowUp className="size-4" />
    </IconTooltip>
  );
  const skipButton = onCancel !== undefined && (
    <Button
      variant="ghost"
      data-testid="chief-question-skip"
      disabled={!pending}
      className={SKIP_CLS}
      onClick={skip}
    >
      {t('跳过')}
    </Button>
  );
  const freeText = question.options.length === 0;

  return (
    <section
      data-testid="chief-question"
      data-request-id={item.requestId}
      data-multi={multi ? '' : undefined}
      aria-label={t('待回答的提问')}
      onKeyDown={onKeyDown}
      className={cn(DOCK_CLS, enter && 'dock-enter')}
    >
      <div className="flex min-h-0 flex-[0_1_auto] items-start gap-2 overflow-y-auto overscroll-contain pt-3 pr-2 pb-1 pl-4 [scrollbar-width:thin]">
        <div
          id={headId}
          data-testid="chief-question-text"
          title={question.header === '' ? undefined : question.header}
          className="min-w-0 flex-1 font-reply text-reply text-pretty text-foreground wrap-anywhere [&_p]:m-0"
        >
          <ChatMarkdown text={question.question} />
        </div>
        <DockTools pager={pager} onMinimize={onMinimize} />
      </div>
      <fieldset
        ref={listRef}
        aria-labelledby={headId}
        className="m-0 min-h-0 min-w-0 flex-[0_1_auto] border-0 overflow-y-auto overscroll-contain px-2 pt-1 pb-2 [scrollbar-width:thin]"
      >
        {question.options.map((option, oi) => {
          const description =
            option.description !== undefined && option.description !== ''
              ? option.description
              : null;
          const label = (
            <OptionLabel
              label={option.label}
              description={description}
              recommended={oi === 0 && option.recommended === true}
            />
          );
          const on = picked.includes(option.label);
          return multi ? (
            <Button
              key={oi}
              type="button"
              aria-pressed={on}
              data-dock-row=""
              data-testid={`chief-question-option-${step}-${oi}`}
              disabled={disabled}
              variant="ghost"
              className={cn(ROW_CLS, ROW_BUTTON_CLS)}
              onClick={() => choose(oi)}
            >
              <CheckBox on={on} />
              {label}
            </Button>
          ) : (
            <Button
              key={oi}
              type="button"
              data-dock-row=""
              data-testid={`chief-question-option-${step}-${oi}`}
              aria-pressed={on}
              disabled={disabled}
              variant="ghost"
              className={cn(ROW_CLS, ROW_BUTTON_CLS)}
              onClick={() => choose(oi)}
            >
              <span aria-hidden className={KEY_CLS}>
                {oi + 1}
              </span>
              {label}
            </Button>
          );
        })}
        <div
          className={cn(
            ROW_CLS,
            'grid-cols-[24px_minmax(0,1fr)_auto] focus-within:bg-(--menu-hover)',
          )}
        >
          {multi ? (
            <CheckBox on={typed} />
          ) : (
            <span aria-hidden className={KEY_CLS}>
              <Pencil className="size-4" strokeWidth={1.75} />
            </span>
          )}
          <Input
            data-dock-row=""
            data-testid={`chief-question-other-${step}`}
            type="text"
            autoComplete="off"
            value={otherText}
            disabled={disabled}
            placeholder={freeText ? t('输入你的回答') : t('输入你自己的回答…')}
            aria-label={freeText ? t('输入你的回答') : t('输入你自己的回答…')}
            className={OTHER_INPUT_CLS}
            onChange={(event) => setOther(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
              if (event.ctrlKey || event.metaKey) return;
              event.preventDefault();
              advance();
            }}
          />
          {!multi && (typed ? go('chief-question-submit', canAdvance) : skipButton)}
        </div>
      </fieldset>
      {multi && (
        <div className="flex min-h-11 flex-none items-center gap-2 border-t border-border py-2 pr-3 pl-4">
          <span
            data-testid="chief-question-count"
            className="mr-auto text-meta text-content-tertiary tabular-nums"
          >
            {t('已选 {n} 个', { n: count })}
          </span>
          {skipButton}
          {go('chief-question-submit', canAdvance)}
        </div>
      )}
      {footer}
    </section>
  );
}
