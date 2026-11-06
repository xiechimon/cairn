import type { AskUserAnswer } from '@cairn/shared';
import {
  Ban,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  CircleHelp,
  type LucideIcon,
  X,
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
import { ShortcutHint } from '../components/shortcut-hint.js';
import { Button } from '../components/ui/button.js';
import { DIALOG_PRIMARY_BUTTON } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import type { ChiefStreamItem } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { questionDockState } from './question-dock-state.js';
import {
  applyQuestionPick,
  emptyQuestionDrafts,
  type QuestionDraft,
  questionDraftComplete,
  questionDraftStore,
  replaceQuestionDraft,
} from './question-drafts.js';

let mountedComposerCards = 0;

export type ChiefQuestionItem = Extract<ChiefStreamItem, { kind: 'question' }>;

export interface ChiefQuestionCardProps {
  item: ChiefQuestionItem;
  onAnswer?: (input: { requestId: string; answers: AskUserAnswer[] }) => void;
  onCancel?: (requestId: string) => void;
  numberKeys?: boolean;
  draftKey?: string;
  pager?: QuestionPager;
  composer?: QuestionComposer;
}

export interface QuestionComposer {
  text: string;
  setText: (value: string) => void;
}

export interface QuestionPager {
  label: string;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}

const CARD_CLS =
  'flex flex-col gap-3 rounded-(--radius-card) border border-border bg-card px-3.5 py-3';
const HINT_CLS = 'min-w-0 flex-1 truncate text-caption text-content-tertiary';
const NUM_CLS =
  'grid size-5 shrink-0 place-items-center rounded-(--cds-radius-sm) border text-caption leading-none font-semibold';
const NUM_OFF_CLS = 'bg-card text-content-tertiary';
const NUM_ON_CLS = 'border-transparent bg-primary text-primary-foreground';
const ATTACHED_CARD_CLS =
  '@container flex max-h-[40dvh] min-h-0 flex-col overflow-hidden rounded-t-(--radius-composer) border border-b-0 border-border bg-card shadow-(--e1)';
const OPTION_ROW_CLS =
  'h-auto w-full items-start justify-start gap-2.5 whitespace-normal rounded-md px-2 py-1.5 text-left font-normal';
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

function QuestionStatus({
  status,
  quiet = false,
}: {
  status: ChiefQuestionItem['status'];
  quiet?: boolean;
}) {
  const { t } = useI18n();
  const { icon: Icon, ink, label } = QUESTION_STATUS[status];
  return (
    <span
      data-testid="chief-question-status"
      className={
        quiet
          ? 'sr-only'
          : `flex min-w-0 shrink-0 items-center gap-1 text-meta whitespace-nowrap ${ink}`
      }
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
    commit: (nextDrafts: QuestionDraft[], nextStep: number) => {
      if (draftKey !== undefined) persist(nextDrafts, nextStep);
      else {
        setLocalDrafts(nextDrafts);
        setLocalStep(nextStep);
      }
    },
  };
}

export function ChiefQuestionCard({
  item,
  onAnswer,
  onCancel,
  numberKeys = false,
  draftKey,
  pager,
  composer,
}: ChiefQuestionCardProps) {
  const { t } = useI18n();
  const questions = useMemo(() => item.questions.map(recommendedFirst), [item.questions]);
  const { drafts, step, submitting, setDrafts, setStep, commit } = useQuestionDrafts(
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
  useSyncExternalStore(questionDockState.subscribe, questionDockState.snapshot, () => 0);
  const collapsed = questionDockState.isCollapsed(item.requestId);
  useEffect(() => {
    if (item.status !== 'pending') questionDockState.forgetCollapsed(item.requestId);
  }, [item.status, item.requestId]);
  const toggleCollapsed = () => questionDockState.toggleCollapsed(item.requestId);

  useLayoutEffect(() => {
    if (
      !pending ||
      collapsed ||
      !numberKeys ||
      question === undefined ||
      question.options.length === 0
    )
      return;
    const max = question.options.length;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (cardRef.current?.checkVisibility() !== true) return;
      const target = e.target;
      if (target instanceof HTMLElement && !digitsReachCard(target)) return;
      const n = Number.parseInt(e.key, 10);
      if (!Number.isInteger(n) || n < 1 || n > max) return;
      e.preventDefault();
      if (question.multiSelect !== true) composer?.setText('');
      setDrafts((prev) => applyQuestionPick(prev, step, question, n - 1));
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [pending, collapsed, numberKeys, step, question]);

  const withComposerText = (
    stored: QuestionDraft | undefined,
    prompt: Question | undefined,
    text: string,
  ) => {
    if (stored === undefined || prompt === undefined) return stored;
    if (stored.kind === 'text') return { kind: 'text' as const, value: text };
    if (text.trim() === '') return { ...stored, other: false, otherText: '' };
    if (prompt.multiSelect === true) return { ...stored, other: true, otherText: text };
    return { kind: 'choices' as const, picked: [], other: true, otherText: text };
  };
  const effective = (index: number): QuestionDraft | undefined =>
    composer !== undefined && index === step
      ? withComposerText(drafts[index], questions[index], composer.text)
      : drafts[index];
  const effectiveDrafts = drafts.map((stored, index) => effective(index) ?? stored);
  const stepComplete = questionDraftComplete(effective(step), question);
  const allComplete =
    pending && questions.every((q, i) => questionDraftComplete(effectiveDrafts[i], q));

  const textOf = (stored: QuestionDraft | undefined): string => {
    if (stored === undefined) return '';
    if (stored.kind === 'text') return stored.value;
    return stored.other ? stored.otherText : '';
  };

  const submit = () => {
    if (!allComplete) return;
    commit(effectiveDrafts, step);
    onAnswer?.({
      requestId: item.requestId,
      answers: effectiveDrafts.map((d, i) => {
        const header = questions[i]?.header ?? '';
        if (d.kind === 'text') return { header, text: d.value.trim() };
        const choices = [...d.picked];
        if (d.other && d.otherText.trim() !== '') choices.push(d.otherText.trim());
        return { header, choices };
      }),
    });
    composer?.setText('');
  };

  const primaryEnabled = pending && (last ? allComplete : stepComplete);
  const advance = () => {
    if (!primaryEnabled) return;
    if (last) {
      submit();
      return;
    }
    setStep((s) => Math.min(lastStep, s + 1));
  };

  const latestRef = useRef({ composer, drafts, step, questions, pending, commit });
  latestRef.current = { composer, drafts, step, questions, pending, commit };
  useEffect(() => {
    let counted = false;
    if (composer !== undefined && pending) {
      const stored = textOf(drafts[step]);
      if (stored !== '' || mountedComposerCards > 0) composer.setText(stored);
      mountedComposerCards += 1;
      counted = true;
    }
    return () => {
      if (counted) queueMicrotask(() => (mountedComposerCards -= 1));
      const latest = latestRef.current;
      if (latest.composer === undefined || !latest.pending) return;
      const stored = withComposerText(
        latest.drafts[latest.step],
        latest.questions[latest.step],
        latest.composer.text,
      );
      if (stored !== undefined)
        latest.commit(
          latest.drafts.map((draftAt, index) => (index === latest.step ? stored : draftAt)),
          latest.step,
        );
      latest.composer.setText('');
    };
  }, []);
  const wasSubmittingRef = useRef(submitting);
  useEffect(() => {
    const was = wasSubmittingRef.current;
    wasSubmittingRef.current = submitting;
    if (was && !submitting && composer !== undefined && composer.text === '')
      composer.setText(textOf(drafts[step]));
  }, [submitting]);

  const previousStepRef = useRef(step);
  useEffect(() => {
    const previous = previousStepRef.current;
    previousStepRef.current = step;
    if (previous === step || composer === undefined) return;
    const stored = withComposerText(drafts[previous], questions[previous], composer.text);
    commit(
      drafts.map((draftAt, index) =>
        index === previous && stored !== undefined ? stored : draftAt,
      ),
      step,
    );
    composer.setText(textOf(drafts[step]));
  }, [step]);

  useEffect(() => {
    if (!pending || composer === undefined) {
      questionDockState.clearPrimary(item.requestId);
      return;
    }
    questionDockState.setPrimary({
      requestId: item.requestId,
      last,
      enabled: primaryEnabled,
      advance: () => advanceRef.current(),
    });
  }, [pending, composer === undefined, item.requestId, last, primaryEnabled]);
  useEffect(() => () => questionDockState.clearPrimary(item.requestId), [item.requestId]);

  const advanceRef = useRef(advance);
  advanceRef.current = advance;
  useEffect(() => {
    const node = cardRef.current;
    if (node === null) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      advanceRef.current();
    };
    node.addEventListener('keydown', handler);
    return () => node.removeEventListener('keydown', handler);
  }, [item.status]);

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
  const multi = question.multiSelect === true;
  const hintText =
    question.options.length === 0
      ? ''
      : multi
        ? pickedCount > 0
          ? t('已选 {n} 项', { n: pickedCount })
          : t('未选')
        : '';
  const shownPager: QuestionPager | undefined =
    pager ??
    (total > 1
      ? {
          label: t('{n} / {total}', { n: step + 1, total }),
          canPrev: step > 0,
          canNext: !last && stepComplete,
          onPrev: () => setStep((s) => Math.max(0, s - 1)),
          onNext: () => setStep((s) => Math.min(lastStep, s + 1)),
        }
      : undefined);
  const pick = (optionIndex: number) => {
    if (question.multiSelect !== true) composer?.setText('');
    setDrafts((prev) => applyQuestionPick(prev, step, question, optionIndex));
  };

  return (
    <div
      ref={cardRef}
      data-testid="chief-question-card"
      data-status={item.status}
      data-collapsed={collapsed ? '' : undefined}
      className={ATTACHED_CARD_CLS}
    >
      <div className="flex flex-none items-center gap-1 px-3.5 pt-2 pb-1">
        <QuestionStatus status={item.status} quiet={!collapsed} />
        <Button
          variant="ghost"
          data-testid="chief-question-collapse"
          aria-expanded={!collapsed}
          title={collapsed ? t('展开提问') : t('收起提问')}
          className="h-auto min-w-0 flex-1 justify-start gap-2 rounded-sm px-0 py-0.5 text-left text-caption font-normal text-content-tertiary hover:bg-transparent aria-expanded:bg-transparent"
          onClick={toggleCollapsed}
        >
          <span className={collapsed ? 'max-w-1/2 truncate' : 'truncate'}>
            {collapsed ? question.header : `${t('问题')} · ${question.header}`}
          </span>
          {collapsed && (
            <>
              <span aria-hidden className="h-3 w-px flex-none bg-border" />
              <span className="min-w-0 flex-1 truncate text-foreground">{question.question}</span>
            </>
          )}
        </Button>
        {shownPager !== undefined && (
          <div className="flex flex-none items-center">
            <Button
              variant="ghost"
              size="icon-xs"
              data-testid="chief-question-prev"
              aria-label={t('上一步')}
              disabled={!pending || !shownPager.canPrev}
              onClick={shownPager.onPrev}
            >
              <ChevronLeft aria-hidden className="size-3.5" />
            </Button>
            <span
              data-testid="chief-question-position"
              className="text-caption tabular-nums text-content-tertiary"
            >
              {shownPager.label}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              data-testid="chief-question-next"
              aria-label={t('下一步')}
              disabled={!pending || !shownPager.canNext}
              onClick={shownPager.onNext}
            >
              <ChevronRight aria-hidden className="size-3.5" />
            </Button>
          </div>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={collapsed ? t('展开提问') : t('收起提问')}
          onClick={toggleCollapsed}
        >
          {collapsed ? (
            <ChevronUp aria-hidden className="size-3.5" />
          ) : (
            <ChevronDown aria-hidden className="size-3.5" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          data-testid="chief-question-dismiss"
          aria-label={t('取消提问')}
          title={t('取消提问')}
          disabled={!pending || onCancel === undefined}
          onClick={() =>
            questionDockState.dismissWithUndo(
              item.requestId,
              { title: t('已取消提问'), undo: t('撤销') },
              () => onCancel?.(item.requestId),
            )
          }
        >
          <X aria-hidden className="size-3.5" />
        </Button>
      </div>
      {!collapsed && (
        <>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <div
              data-testid="chief-question-text"
              className="flex-none px-3.5 pb-1.5 text-ui break-words text-foreground"
            >
              {question.question}
            </div>
            {question.options.length === 0 ? (
              composer !== undefined ? null : (
                <div className="flex-none px-3.5 pb-2">
                  <Input
                    data-testid={`chief-question-input-${step}`}
                    className={FORM_CONTROL_CLS}
                    placeholder={t('输入你的回答')}
                    value={draft?.kind === 'text' ? draft.value : ''}
                    disabled={!pending}
                    onChange={(e) => {
                      const value = e.target.value;
                      setDrafts((prev) =>
                        replaceQuestionDraft(prev, step, { kind: 'text', value }),
                      );
                    }}
                  />
                </div>
              )
            ) : (
              <div className="flex flex-none flex-col px-1.5 pb-1.5">
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
                          <span className="text-caption text-content-tertiary">
                            {option.description}
                          </span>
                        )}
                      </span>
                      {oi < 9 && <Keycap>{oi + 1}</Keycap>}
                    </Button>
                  );
                })}
              </div>
            )}
          </div>
          {composer === undefined && (
            <div className="flex flex-none flex-wrap items-center gap-2 px-3.5 py-1.5">
              {hintText !== '' && (
                <span data-testid="chief-question-hint" className={HINT_CLS}>
                  {hintText}
                </span>
              )}
              <Button
                className={`${DIALOG_PRIMARY_BUTTON} ml-auto`}
                disabled={!primaryEnabled}
                onClick={advance}
              >
                {last ? t('提交回答') : t('下一步')}
                <ShortcutHint
                  keys={['mod', 'enter']}
                  className="@max-md:hidden pointer-coarse:hidden ml-1"
                />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Keycap({ children }: { children: ReactNode }) {
  return (
    <span className="grid h-5 min-w-5 flex-none place-items-center rounded-(--cds-radius-sm) bg-(--hover-1) px-1 text-caption tabular-nums text-content-tertiary">
      {children}
    </span>
  );
}

function ChoiceMark({ multi, selected }: { multi: boolean; selected: boolean }) {
  const shape = multi ? 'rounded-md' : 'rounded-full';
  return (
    <span
      aria-hidden
      className={`mt-0.5 grid size-4 flex-none place-items-center border ${shape} ${
        selected ? 'border-transparent bg-primary text-primary-foreground' : 'border-input'
      }`}
    >
      {selected &&
        (multi ? (
          <Check strokeWidth={2.5} className="size-2.5" />
        ) : (
          <span className="size-1.5 rounded-full bg-primary-foreground" />
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
