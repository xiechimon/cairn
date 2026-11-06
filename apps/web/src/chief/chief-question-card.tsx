import type { AskUserAnswer } from '@cairn/shared';
import {
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleHelp,
  type LucideIcon,
} from 'lucide-react';
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { STATUS_WORDS } from '../board/status-words.js';
import { FORM_CONTROL_CLS } from '../components/form-layout.js';
import { Button } from '../components/ui/button.js';
import { DIALOG_PRIMARY_BUTTON, DIALOG_TEXT_BUTTON } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import type { ChiefStreamItem } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import {
  applyQuestionPick,
  emptyQuestionDrafts,
  type QuestionDraft,
  questionDraftComplete,
  questionDraftStore,
  replaceQuestionDraft,
} from './question-drafts.js';

export type ChiefQuestionItem = Extract<ChiefStreamItem, { kind: 'question' }>;

export interface ChiefQuestionCardProps {
  item: ChiefQuestionItem;
  onAnswer?: (input: { requestId: string; answers: AskUserAnswer[] }) => void;
  onCancel?: (requestId: string) => void;
  numberKeys?: boolean;
  draftKey?: string;
}

const CARD_CLS =
  'flex flex-col gap-3 rounded-(--radius-card) border border-border bg-card px-3.5 py-3';
const HINT_CLS = 'min-w-0 flex-1 truncate text-caption text-content-tertiary';
const NUM_CLS =
  'grid size-5 shrink-0 place-items-center rounded-(--cds-radius-sm) border text-caption leading-none font-semibold';
const NUM_OFF_CLS = 'bg-card text-content-tertiary';
const NUM_ON_CLS = 'border-transparent bg-primary text-primary-foreground';
const PENDING_CARD_CLS =
  '@container flex min-h-0 flex-col overflow-hidden rounded-(--radius-card) bg-card shadow-(--e1)';
const OPTION_ROW_CLS =
  'h-auto w-full justify-start gap-4 whitespace-normal rounded-none px-4 py-4 text-left font-normal';
const OPT_SEL_CLS = 'border-ring bg-(--menu-hover)';
const OPT_TXT_CLS = 'min-w-0 flex-1';
const ROW_STATIC_CLS =
  'flex w-full items-center gap-2 rounded-md border border-border px-3 py-2.5 text-ui leading-normal text-foreground';

const STATUS_WAITING_INK = 'text-(--card-button)';
const QUESTION_STATUS: Record<
  ChiefQuestionItem['status'],
  { icon: LucideIcon; ink: string; label: string }
> = {
  pending: { icon: CircleHelp, ink: STATUS_WAITING_INK, label: STATUS_WORDS.needsYou },
  answered: { icon: CircleCheck, ink: 'text-content-tertiary', label: '已回答' },
  cancelled: { icon: Ban, ink: 'text-content-tertiary', label: '已取消' },
};

function QuestionStatus({ status }: { status: ChiefQuestionItem['status'] }) {
  const { t } = useI18n();
  const { icon: Icon, ink, label } = QUESTION_STATUS[status];
  return (
    <span
      data-testid="chief-question-status"
      className={`flex min-w-0 shrink-0 items-center gap-1 text-meta whitespace-nowrap ${ink}`}
    >
      <Icon aria-hidden strokeWidth={1.75} className="size-3.25" />
      <span className="@max-md:sr-only">{t(label)}</span>
    </span>
  );
}

type Question = ChiefQuestionItem['questions'][number];

function digitsReachCard(target: HTMLElement): boolean {
  if (target.isContentEditable) return false;
  if (target instanceof HTMLTextAreaElement && target.hasAttribute('data-compose-target'))
    return target.value === '';
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

function RecommendedMark() {
  const { t } = useI18n();
  return (
    <span data-testid="chief-question-recommended" className="text-meta text-content-tertiary">
      {t('（推荐）')}
    </span>
  );
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
  const [localDrafts, setLocalDrafts] = useState(() => emptyQuestionDrafts(questions));
  const [localStep, setLocalStep] = useState(0);
  const drafts = stored?.drafts ?? localDrafts;
  const step = stored?.step ?? localStep;
  const submitting = stored?.submitting === true;
  const persist = (nextDrafts: QuestionDraft[], nextStep: number) => {
    if (draftKey === undefined) return;
    questionDraftStore.set(draftKey, {
      drafts: nextDrafts,
      step: nextStep,
      submitting,
      error: null,
    });
  };
  useEffect(() => {
    if (draftKey !== undefined && item.status !== 'pending') questionDraftStore.clear(draftKey);
  }, [draftKey, item.status]);
  return {
    drafts,
    step,
    submitting,
    setDrafts: (update: (prev: QuestionDraft[]) => QuestionDraft[]) => {
      const next = update(drafts);
      if (draftKey !== undefined) persist(next, step);
      else setLocalDrafts(next);
    },
    setStep: (update: (prev: number) => number) => {
      const next = update(step);
      if (draftKey !== undefined) persist(drafts, next);
      else setLocalStep(next);
    },
  };
}

export function ChiefQuestionCard({
  item,
  onAnswer,
  onCancel,
  numberKeys = false,
  draftKey,
}: ChiefQuestionCardProps) {
  const { t } = useI18n();
  const questions = useMemo(() => item.questions.map(recommendedFirst), [item.questions]);
  const { drafts, step, submitting, setDrafts, setStep } = useQuestionDrafts(
    item,
    questions,
    draftKey,
  );
  const pending = item.status === 'pending' && onAnswer !== undefined && !submitting;
  const total = questions.length;
  const lastStep = total - 1;
  const last = step === lastStep;
  const question = questions[step] ?? questions[0];
  const draft = drafts[step];
  const cardRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!pending || !numberKeys || question === undefined || question.options.length === 0) return;
    const max = question.options.length + 1;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (cardRef.current?.checkVisibility() !== true) return;
      const target = e.target;
      if (target instanceof HTMLElement && !digitsReachCard(target)) return;
      const n = Number.parseInt(e.key, 10);
      if (!Number.isInteger(n) || n < 1 || n > max) return;
      e.preventDefault();
      setDrafts((prev) => applyQuestionPick(prev, step, question, n - 1));
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [pending, numberKeys, step, question]);

  const stepComplete = useMemo(() => questionDraftComplete(draft, question), [draft, question]);
  const allComplete = useMemo(
    () => pending && questions.every((q, i) => questionDraftComplete(drafts[i], q)),
    [pending, drafts, questions],
  );

  const submit = () => {
    if (!allComplete) return;
    onAnswer?.({
      requestId: item.requestId,
      answers: drafts.map((d, i) => {
        const header = questions[i]?.header ?? '';
        if (d.kind === 'text') return { header, text: d.value.trim() };
        const choices = [...d.picked];
        if (d.other && d.otherText.trim() !== '') choices.push(d.otherText.trim());
        return { header, choices };
      }),
    });
  };

  if (question === undefined) return null;

  if (item.status !== 'pending') {
    return (
      <div
        data-testid="chief-question-card"
        data-status={item.status}
        className={`${CARD_CLS}${item.status === 'cancelled' ? ' opacity-70' : ''}`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-ui font-medium text-foreground">{t('Coordinator 提问')}</span>
          <QuestionStatus status={item.status} />
        </div>
        <div className="flex flex-col gap-3">
          {questions.map((q, qi) => (
            <div key={qi} className="flex flex-col gap-1.5">
              <div className="text-caption text-content-tertiary">{q.header}</div>
              <div className="text-ui text-foreground">{q.question}</div>
              {q.options.length === 0 ? (
                <div
                  data-testid={`chief-question-answer-${qi}`}
                  className="rounded-md border border-input px-3 py-2.5 text-ui text-foreground"
                >
                  {item.answers?.[qi]?.text ?? ''}
                </div>
              ) : (
                answeredRows(q, qi, item.answers)
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const pickedCount = draft?.kind === 'choices' ? draft.picked.length : 0;
  const otherSelected = draft?.kind === 'choices' && draft.other;
  const multi = question.multiSelect === true;
  const hintText =
    question.options.length === 0
      ? ''
      : multi
        ? pickedCount > 0
          ? t('已选 {n} 项', { n: pickedCount })
          : t('未选')
        : '';
  const pick = (optionIndex: number) =>
    setDrafts((prev) => applyQuestionPick(prev, step, question, optionIndex));

  return (
    <div
      ref={cardRef}
      data-testid="chief-question-card"
      data-status={item.status}
      className={PENDING_CARD_CLS}
    >
      <div className="flex flex-none items-start gap-4 bg-(--hover-1) px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-caption text-content-tertiary">{question.header}</span>
          <div data-testid="chief-question-text" className="text-ui text-foreground">
            {question.question}
          </div>
        </div>
        {total > 1 && (
          <div className="flex flex-none items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              data-testid="chief-question-step-prev"
              aria-label={t('上一步')}
              disabled={!pending || step === 0}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
            >
              <ChevronLeft aria-hidden className="size-4" />
            </Button>
            <span
              data-testid="chief-question-step"
              className="text-caption tabular-nums text-content-tertiary"
            >
              {t('{n} / {total}', { n: step + 1, total })}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              data-testid="chief-question-step-next"
              aria-label={t('下一步')}
              disabled={!pending || last || !stepComplete}
              onClick={() => setStep((s) => Math.min(lastStep, s + 1))}
            >
              <ChevronRight aria-hidden className="size-4" />
            </Button>
          </div>
        )}
      </div>
      {question.options.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <Input
            data-testid={`chief-question-input-${step}`}
            className={FORM_CONTROL_CLS}
            placeholder={t('输入你的回答')}
            value={draft?.kind === 'text' ? draft.value : ''}
            disabled={!pending}
            onChange={(e) => {
              const value = e.target.value;
              setDrafts((prev) => replaceQuestionDraft(prev, step, { kind: 'text', value }));
            }}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col divide-y divide-border overflow-y-auto">
          {question.options.map((option, oi) => {
            const selected = draft?.kind === 'choices' && draft.picked.includes(option.label);
            return (
              <Button
                key={oi}
                variant="ghost"
                data-testid={`chief-question-option-${step}-${oi}`}
                disabled={!pending}
                aria-pressed={selected}
                className={OPTION_ROW_CLS}
                onClick={() => pick(oi)}
              >
                <ChoiceMark multi={multi} selected={selected} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-ui text-foreground">
                    {option.label}
                    {option.recommended === true && (
                      <>
                        {' '}
                        <RecommendedMark />
                      </>
                    )}
                  </span>
                  {option.description !== undefined && (
                    <span className="text-ui text-content-tertiary">{option.description}</span>
                  )}
                </span>
                {oi < 9 && (
                  <span className="flex-none text-caption tabular-nums text-content-tertiary">
                    {oi + 1}
                  </span>
                )}
              </Button>
            );
          })}
          <div className="flex flex-col">
            <Button
              variant="ghost"
              data-testid={`chief-question-other-${step}`}
              disabled={!pending}
              aria-pressed={otherSelected}
              className={OPTION_ROW_CLS}
              onClick={() => pick(question.options.length)}
            >
              <ChoiceMark multi={multi} selected={otherSelected} />
              <span className="min-w-0 flex-1 text-ui text-foreground">
                {t('用我自己的话回答')}
              </span>
              {question.options.length < 9 && (
                <span className="flex-none text-caption tabular-nums text-content-tertiary">
                  {question.options.length + 1}
                </span>
              )}
            </Button>
            {otherSelected && (
              <div className="px-4 pb-4 pl-13">
                <Input
                  data-testid={`chief-question-input-${step}`}
                  className={FORM_CONTROL_CLS}
                  placeholder={t('输入你的回答')}
                  value={draft?.kind === 'choices' ? draft.otherText : ''}
                  disabled={!pending}
                  onChange={(e) => {
                    const value = e.target.value;
                    setDrafts((prev) => {
                      const current = prev[step];
                      if (current?.kind !== 'choices') return prev;
                      return replaceQuestionDraft(prev, step, { ...current, otherText: value });
                    });
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}
      <div className="flex flex-none items-center gap-2 px-4 py-3">
        <QuestionStatus status={item.status} />
        {hintText !== '' && (
          <span data-testid="chief-question-hint" className={HINT_CLS}>
            {hintText}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            className={DIALOG_TEXT_BUTTON}
            disabled={!pending || onCancel === undefined}
            onClick={() => onCancel?.(item.requestId)}
          >
            {t('取消提问')}
          </Button>
          <Button
            className={DIALOG_PRIMARY_BUTTON}
            disabled={!pending || !(last ? allComplete : stepComplete)}
            onClick={() => {
              if (last) submit();
              else setStep((s) => Math.min(lastStep, s + 1));
            }}
          >
            {last ? t('提交回答') : t('下一步')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ChoiceMark({ multi, selected }: { multi: boolean; selected: boolean }) {
  const shape = multi ? 'rounded-md' : 'rounded-full';
  return (
    <span
      aria-hidden
      className={`mt-0.5 grid size-5 flex-none place-items-center border ${shape} ${
        selected ? 'border-transparent bg-primary text-primary-foreground' : 'border-input'
      }`}
    >
      {selected &&
        (multi ? (
          <Check strokeWidth={2.5} className="size-3" />
        ) : (
          <span className="size-2 rounded-full bg-primary-foreground" />
        ))}
    </span>
  );
}

function answeredRows(
  question: ChiefQuestionItem['questions'][number],
  qi: number,
  answers: { header: string; choices?: string[]; text?: string }[] | null,
): ReactNode {
  const choices = answers?.[qi]?.choices ?? null;
  const otherAnswers =
    choices === null ? [] : choices.filter((c) => !question.options.some((o) => o.label === c));
  return (
    <div className="flex flex-col gap-1.5">
      {question.options.map((option, oi) => {
        const picked = choices?.includes(option.label) === true;
        return (
          <div
            key={oi}
            data-testid={`chief-question-option-${qi}-${oi}`}
            className={`${ROW_STATIC_CLS}${picked ? ` ${OPT_SEL_CLS}` : ''}`}
          >
            <span className={`${NUM_CLS} ${picked ? NUM_ON_CLS : NUM_OFF_CLS}`}>{oi + 1}</span>
            <span className={OPT_TXT_CLS}>
              {option.label}
              {option.recommended === true && (
                <>
                  {' '}
                  <RecommendedMark />
                </>
              )}
            </span>
          </div>
        );
      })}
      {otherAnswers.length > 0 && (
        <div className={`${ROW_STATIC_CLS} ${OPT_SEL_CLS}`}>
          <span className={`${NUM_CLS} ${NUM_ON_CLS}`}>{question.options.length + 1}</span>
          <span data-testid={`chief-question-answer-${qi}`} className={OPT_TXT_CLS}>
            {otherAnswers.join('；')}
          </span>
        </div>
      )}
    </div>
  );
}
