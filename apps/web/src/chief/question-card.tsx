import type { AskUserAnswer } from '@cairn/shared';
import { cn } from 'cn';
import { ArrowUp, ChevronDown, Pencil } from 'lucide-react';
import {
  type CSSProperties,
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
import { Checkbox } from '../components/ui/checkbox.js';
import { Input } from '../components/ui/input.js';
import { toastSuccess } from '../components/ui/toaster.js';
import { ChatMarkdown, REPLY_BLOCK_CLS } from '../detail/chat-markdown.js';
import type { ChiefStreamItem } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { joinDraft, splitDraft } from '../overlay/attachment-paste.js';
import { ApprovalCard } from './approval-card.js';
import { approvalCardOf, isApprovalRequest } from './approval-card-model.js';
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

export type ChiefQuestionItem = Extract<ChiefStreamItem, { kind: 'question' }>;

export interface QuestionCardProps {
  item: ChiefQuestionItem;
  onAnswer?: (input: { requestId: string; answers: AskUserAnswer[] }) => void;
  onCancel?: (requestId: string) => void;
  draftKey?: string;
  bound?: boolean;
  grow?: boolean;
  pager?: ReactNode;
  onCollapse?: () => void;
}

const OPTION_GROW_LEAD_MS = 120;
const OPTION_GROW_STEP_MS = 80;

const ROW_CLS =
  'relative grid min-h-10 w-full min-w-0 grid-cols-[24px_minmax(0,1fr)] items-center gap-x-3 rounded-(--radius-control) p-2 text-left before:pointer-events-none before:absolute before:inset-x-2 before:top-0 before:h-px before:bg-(--border) first:before:hidden hover:before:opacity-0 [&:hover+*]:before:opacity-0 focus-within:before:opacity-0 [&:focus-within+*]:before:opacity-0 pointer-coarse:min-h-11';
const ROW_HOVER_CLS = 'hover:bg-(--menu-hover) dark:hover:bg-(--menu-hover)';
const KEY_CLS =
  'grid size-6 place-items-center rounded-(--radius-control) bg-(--menu-hover) text-meta tabular-nums text-(--text-tertiary)';
const SKIP_CLS =
  'h-7 flex-none cursor-pointer rounded-(--radius-control) bg-(--menu-hover) px-2.5 text-meta font-normal text-(--text-secondary) hover:bg-(--menu-hover) hover:text-foreground pointer-coarse:h-11 dark:bg-(--menu-hover) dark:hover:bg-(--menu-hover)';
const GO_CLS =
  'size-7 flex-none cursor-pointer rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-(--menu-hover) disabled:text-(--text-tertiary) disabled:opacity-100 pointer-coarse:size-11';
export const QUESTION_TOOL_CLS =
  'size-6 flex-none cursor-pointer rounded-(--radius-control) text-(--text-tertiary) hover:bg-(--menu-hover) hover:text-foreground disabled:opacity-40 pointer-coarse:size-11 dark:hover:bg-(--menu-hover)';

type Question = ChiefQuestionItem['questions'][number];

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

function QuestionError({ draftKey }: { draftKey: string | undefined }) {
  const error = useSyncExternalStore(
    questionDraftStore.subscribe,
    () => (draftKey === undefined ? null : questionSubmitStore.get(draftKey).error),
    () => null,
  );
  if (error === null) return null;
  return (
    <p
      role="status"
      data-testid="chief-question-error"
      className="m-0 px-4 pb-2 text-meta text-destructive"
    >
      {error}
    </p>
  );
}

export function QuestionCard({
  item,
  onAnswer,
  onCancel,
  draftKey,
  bound = false,
  grow = false,
  pager,
  onCollapse,
}: QuestionCardProps) {
  const { t } = useI18n();
  const questions = useMemo(() => item.questions.map(recommendedFirst), [item.questions]);
  const { drafts, step, commit } = useQuestionDrafts(item, questions, draftKey);
  const submitting = useSyncExternalStore(
    questionDraftStore.subscribe,
    () => (draftKey === undefined ? false : questionSubmitStore.get(draftKey).submitting),
    () => false,
  );
  useSyncExternalStore(questionDockState.subscribe, questionDockState.snapshot, () => 0);
  const pending =
    item.status === 'pending' &&
    onAnswer !== undefined &&
    !submitting &&
    !questionDockState.isDismissing(item.requestId);
  const blockedByUpload = draftKey !== undefined && questionDockState.uploading(draftKey);
  const disabled = !pending || blockedByUpload;
  const canInteract = () =>
    !disabled &&
    !questionDockState.isDismissing(item.requestId) &&
    (draftKey === undefined || !questionDockState.uploading(draftKey)) &&
    (draftKey === undefined || !questionSubmitStore.get(draftKey).submitting);
  const last = step === questions.length - 1;
  const question = questions[step] ?? questions[0];
  const draft = drafts[step];
  const blockRef = useRef<HTMLDivElement | null>(null);
  const baseId = useId();
  const [growStep] = useState(grow ? step : -1);

  const [localTexts, setLocalTexts] = useState<Record<number, string>>({});
  const textAt = (index: number): string =>
    draftKey !== undefined
      ? questionDockState.answerText(answerKeyOf(draftKey, index))
      : (localTexts[index] ?? '');
  const setTextAt = (index: number, text: string) => {
    if (draftKey !== undefined) questionDockState.setAnswerText(answerKeyOf(draftKey, index), text);
    else setLocalTexts((prev) => ({ ...prev, [index]: text }));
  };
  const setOtherAt = (index: number, text: string) => {
    setTextAt(index, joinDraft(splitDraft(textAt(index)).tokens, text));
  };
  const typedText = textAt(step);
  const otherText = splitDraft(typedText).text;
  const typedOther = typedText.trim() !== '';
  const multi = question?.multiSelect === true;

  const answerDrafts = (optionIndex?: number): QuestionDraft[] => {
    if (draft === undefined || question === undefined) return drafts;
    if (optionIndex !== undefined) {
      const picked = applyQuestionPick(drafts, step, question, optionIndex);
      const choice = picked[step];
      const tokens = isApprovalRequest(item.requestId) ? [] : splitDraft(textAt(step)).tokens;
      return choice?.kind === 'choices'
        ? replaceQuestionDraft(picked, step, { ...choice, optionAttachments: tokens })
        : picked;
    }
    const text = textAt(step).trim();
    const answer: QuestionDraft =
      draft.kind === 'text'
        ? { kind: 'text', value: text }
        : {
            kind: 'choices',
            picked: multi || text === '' ? draft.picked : [],
            other: text !== '',
            otherText: text,
          };
    return replaceQuestionDraft(drafts, step, answer);
  };
  const ready = (source: QuestionDraft[]) =>
    last
      ? questions.every((prompt, index) => questionDraftComplete(source[index], prompt))
      : questionDraftComplete(source[step], question);
  const canAdvance = !disabled && ready(answerDrafts());
  const submit = (optionIndex?: number) => {
    if (!canInteract()) return;
    const source = answerDrafts(optionIndex);
    if (!ready(source)) return;
    if (!last) setTextAt(step, '');
    commit(source, last ? step : step + 1);
    if (!last) return;
    onAnswer?.({
      requestId: item.requestId,
      answers: source.map((d, i) => {
        const header = questions[i]?.header ?? '';
        if (d.kind === 'text') return { header, text: d.value.trim() };
        const choices = d.picked.map((label) => joinDraft(d.optionAttachments ?? [], label));
        if (d.other && d.otherText.trim() !== '') choices.push(d.otherText.trim());
        return { header, choices };
      }),
    });
  };
  const submitRef = useRef(submit);
  submitRef.current = submit;

  const skip =
    pending && onCancel !== undefined
      ? () =>
          questionDockState.dismissWithUndo(
            item.requestId,
            { title: t('已跳过'), undo: t('撤销') },
            () => onCancel(item.requestId),
          )
      : undefined;
  const dismissApproval =
    pending && onCancel !== undefined
      ? () =>
          questionDockState.dismissWithUndo(
            item.requestId,
            { title: t('已取消提问'), undo: t('撤销') },
            () => onCancel(item.requestId),
          )
      : undefined;
  const approval =
    question !== undefined && isApprovalRequest(item.requestId)
      ? approvalCardOf(question, t)
      : null;
  const escapeRef = useRef<(() => void) | undefined>(undefined);
  escapeRef.current = approval !== null ? dismissApproval : onCollapse;

  const choose = (optionIndex: number) => {
    if (question === undefined || !canInteract()) return;
    if (multi) commit(applyQuestionPick(drafts, step, question, optionIndex), step);
    else submit(optionIndex);
  };

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
      advance: () => submitRef.current(),
    });
  }, [pending, bound, item.requestId, last, canAdvance]);
  useEffect(() => () => questionDockState.clearPrimary(item.requestId), [item.requestId]);

  useEffect(() => {
    if (!questionDockState.takeFocusRow(item.requestId)) return;
    blockRef.current?.querySelector<HTMLElement>('[data-question-row]')?.focus({
      preventScroll: true,
    });
  });

  useEffect(() => {
    const node = blockRef.current;
    if (node === null) return;
    const handler = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === 'Escape') {
        if (escapeRef.current === undefined) return;
        event.preventDefault();
        escapeRef.current();
        return;
      }
      const target = event.target instanceof HTMLElement ? event.target : null;
      const typing = target?.matches('input[type="text"], input:not([type])') === true;
      if (
        event.key === 'Enter' &&
        (event.ctrlKey || event.metaKey || (typing && !event.shiftKey))
      ) {
        event.preventDefault();
        submitRef.current();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const rows = [...node.querySelectorAll<HTMLElement>('[data-question-row]')];
      if (!typing && /^[1-9]$/.test(event.key)) {
        const row = rows[Number(event.key) - 1];
        if (row === undefined) return;
        event.preventDefault();
        row.focus();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const at = rows.findIndex((row) => row === target || row.contains(target));
      if (at < 0) return;
      event.preventDefault();
      rows[(at + (event.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length]?.focus();
    };
    node.addEventListener('keydown', handler);
    return () => node.removeEventListener('keydown', handler);
  }, [item.status]);

  if (question === undefined || item.status !== 'pending') return null;

  const copyText = (text: string) => {
    void navigator.clipboard?.writeText(text).then(
      () => toastSuccess(t('已复制')),
      () => {},
    );
  };
  const submittedIndex =
    submitting && draft?.kind === 'choices'
      ? question.options.findIndex((option) => option.label === draft.picked[0])
      : -1;
  const submittingAction =
    submittedIndex < 0 ? null : `chief-question-option-${step}-${submittedIndex}`;

  if (approval !== null)
    return (
      <div
        ref={blockRef}
        data-testid="chief-question-chips"
        data-status={item.status}
        data-request-id={item.requestId}
        className="flex min-w-0 flex-col items-start gap-1"
      >
        <div
          data-tools-root=""
          className="group/message flex max-w-full min-w-0 flex-col items-start"
        >
          <div className={cn(REPLY_BLOCK_CLS, 'max-w-full')} data-slot="reply-block">
            <ApprovalCard
              card={approval}
              disabled={disabled}
              busy={submittingAction}
              actions={question.options.map((option, oi) => ({
                label: option.label,
                testId: `chief-question-option-${step}-${oi}`,
                onClick: () => choose(oi),
              }))}
            />
            <MessageToolbar
              placement="right"
              testId="chief-question-tools"
              stamp={null}
              onCopy={() => copyText(question.question)}
              onDismiss={dismissApproval}
            />
          </div>
          <MessageToolbar
            placement="below-start"
            testId="chief-question-tools-touch"
            stamp={null}
            onCopy={() => copyText(question.question)}
            onDismiss={dismissApproval}
          />
        </div>
        <QuestionError draftKey={draftKey} />
      </div>
    );

  const questionId = `${baseId}-q`;
  const growing = step === growStep;
  const growStyle = (index: number): CSSProperties | undefined =>
    growing
      ? ({
          '--grow-delay': `${OPTION_GROW_LEAD_MS + index * OPTION_GROW_STEP_MS}ms`,
        } as CSSProperties)
      : undefined;
  const picked = draft?.kind === 'choices' ? draft.picked : [];
  const count = picked.length + (typedOther ? 1 : 0);
  const submitLabel = last ? t('提交回答') : t('下一步');
  const submitButton = (
    <IconTooltip
      label={submitLabel}
      trigger={
        <Button
          variant="ghost"
          size="icon"
          data-testid="chief-question-submit"
          disabled={!canAdvance}
          className={GO_CLS}
          onClick={() => submit()}
        />
      }
    >
      <ArrowUp width={16} height={16} />
    </IconTooltip>
  );
  const skipButton =
    skip === undefined ? null : (
      <Button
        variant="ghost"
        data-testid="chief-question-skip"
        disabled={disabled}
        className={SKIP_CLS}
        onClick={skip}
      >
        {t('跳过')}
      </Button>
    );
  const otherInput = (
    <Input
      data-testid="chief-question-other"
      data-question-row=""
      aria-label={t('输入你自己的回答…')}
      placeholder={t('输入你自己的回答…')}
      autoComplete="off"
      value={otherText}
      disabled={disabled}
      onChange={(event) => setOtherAt(step, event.target.value)}
      className="h-6 min-w-0 border-0 bg-transparent px-0 py-0 text-ui leading-5 text-foreground shadow-none placeholder:text-(--text-tertiary) focus-visible:ring-0 md:text-ui dark:bg-transparent"
    />
  );

  return (
    <div
      ref={blockRef}
      data-testid="chief-question-chips"
      data-status={item.status}
      data-request-id={item.requestId}
      data-multi={multi ? '' : undefined}
      className="flex max-h-full min-h-0 min-w-0 flex-col"
    >
      <div className="flex flex-none items-start gap-2 pt-3 pr-2 pb-1 pl-4">
        <div
          id={questionId}
          data-testid="chief-question-text"
          className="max-h-30 min-w-0 flex-1 overflow-y-auto overscroll-contain voice-response text-heading leading-6 text-pretty text-foreground [overflow-wrap:anywhere] [&_p]:m-0"
        >
          <ChatMarkdown text={question.question} />
        </div>
        {(pager != null || onCollapse !== undefined) && (
          <div className="flex h-6 flex-none items-center">
            {pager}
            {onCollapse !== undefined && (
              <IconTooltip
                label={t('收起')}
                trigger={
                  <Button
                    variant="ghost"
                    size="icon"
                    data-testid="chief-question-collapse"
                    className={cn(QUESTION_TOOL_CLS, 'ml-1')}
                    onClick={onCollapse}
                  />
                }
              >
                <ChevronDown width={16} height={16} strokeWidth={1.75} />
              </IconTooltip>
            )}
          </div>
        )}
      </div>
      <fieldset
        aria-labelledby={questionId}
        data-testid="chief-question-rows"
        className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-2 pt-1 pb-2"
      >
        {question.options.map((option, oi) => {
          const recommended = option.recommended === true;
          const description =
            option.description !== undefined && option.description !== ''
              ? option.description
              : null;
          const label = (
            <span className="flex min-w-0 flex-col">
              <span className="text-ui leading-5 text-foreground [overflow-wrap:anywhere]">
                {option.label}
                {recommended && (
                  <span className="ml-1.5 text-meta leading-5 whitespace-nowrap text-(--text-tertiary)">
                    {t('推荐')}
                  </span>
                )}
              </span>
              {description !== null && (
                <span className="text-meta leading-5 text-pretty text-(--text-tertiary) [overflow-wrap:anywhere]">
                  {description}
                </span>
              )}
            </span>
          );
          if (multi) {
            const checked = picked.includes(option.label);
            return (
              <label
                key={oi}
                htmlFor={`${baseId}-${step}-${oi}`}
                data-testid={`chief-question-option-${step}-${oi}`}
                data-recommended={recommended ? '' : undefined}
                data-grow={growing ? '' : undefined}
                style={growStyle(oi)}
                className={cn(ROW_CLS, ROW_HOVER_CLS, 'cursor-pointer', growing && 'grow-enter')}
              >
                <span className="grid size-6 place-items-center">
                  <Checkbox
                    id={`${baseId}-${step}-${oi}`}
                    data-question-row=""
                    checked={checked}
                    disabled={disabled}
                    onCheckedChange={() => choose(oi)}
                  />
                </span>
                {label}
              </label>
            );
          }
          const selected = picked.includes(option.label);
          return (
            <Button
              key={oi}
              variant="ghost"
              data-testid={`chief-question-option-${step}-${oi}`}
              data-question-row=""
              data-recommended={recommended ? '' : undefined}
              data-grow={growing ? '' : undefined}
              style={growStyle(oi)}
              disabled={disabled}
              aria-pressed={selected}
              className={cn(
                ROW_CLS,
                ROW_HOVER_CLS,
                'h-auto cursor-pointer justify-items-start border-0 font-normal whitespace-normal aria-pressed:bg-(--menu-hover) dark:aria-pressed:bg-(--menu-hover)',
                growing && 'grow-enter',
              )}
              onClick={() => choose(oi)}
            >
              <span aria-hidden data-slot="question-key" className={KEY_CLS}>
                {oi + 1}
              </span>
              {label}
            </Button>
          );
        })}
        <div
          data-testid="chief-question-other-row"
          className={cn(
            ROW_CLS,
            'grid-cols-[24px_minmax(0,1fr)_auto] focus-within:bg-(--menu-hover) dark:focus-within:bg-(--menu-hover)',
          )}
        >
          {multi ? (
            <span className="grid size-6 place-items-center">
              <Checkbox
                aria-label={t('输入你自己的回答…')}
                checked={typedOther}
                disabled={disabled}
                tabIndex={-1}
                onCheckedChange={(next) => {
                  if (!next) setOtherAt(step, '');
                  else
                    blockRef.current
                      ?.querySelector<HTMLInputElement>('[data-testid="chief-question-other"]')
                      ?.focus();
                }}
              />
            </span>
          ) : (
            <span aria-hidden className={KEY_CLS}>
              <Pencil width={14} height={14} strokeWidth={1.75} />
            </span>
          )}
          {otherInput}
          {!multi && (typedOther ? submitButton : skipButton)}
        </div>
      </fieldset>
      {multi && (
        <div className="flex min-h-11 flex-none items-center gap-2 border-t border-(--border) py-2 pr-3 pl-4">
          <span
            data-testid="chief-question-count"
            className="mr-auto text-meta tabular-nums text-(--text-tertiary)"
          >
            {t('已选 {n} 个', { n: count })}
          </span>
          {skipButton}
          {submitButton}
        </div>
      )}
      <QuestionError draftKey={draftKey} />
    </div>
  );
}
