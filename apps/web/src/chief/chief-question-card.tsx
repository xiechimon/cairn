import type { AskUserAnswer } from '@cairn/shared';
import { Ban, CircleCheck, CircleHelp, type LucideIcon } from 'lucide-react';
import { type ReactNode, useLayoutEffect, useMemo, useState } from 'react';
import { FORM_CONTROL_CLS } from '../components/form-layout.js';
import { Button } from '../components/ui/button.js';
import { DIALOG_PRIMARY_BUTTON, DIALOG_TEXT_BUTTON } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import type { ChiefStreamItem } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';

export type ChiefQuestionItem = Extract<ChiefStreamItem, { kind: 'question' }>;

export interface ChiefQuestionCardProps {
  item: ChiefQuestionItem;
  onAnswer?: (input: { requestId: string; answers: AskUserAnswer[] }) => void;
  onCancel?: (requestId: string) => void;
}

type Draft =
  | { kind: 'choices'; picked: string[]; other: boolean; otherText: string }
  | { kind: 'text'; value: string };

const CARD_CLS =
  'flex flex-col gap-3 rounded-(--radius-card) border border-border bg-card px-3.5 py-3';
const PIP_CLS = 'h-0.75 flex-1 rounded-full bg-border transition-colors duration-200 ease-out';
const PIP_ON_CLS = 'bg-primary';
const HINT_CLS = 'flex-1 text-caption text-content-tertiary';
const BIG_CLS = 'text-card-title font-medium text-foreground';
const NUM_CLS =
  'grid size-5 shrink-0 place-items-center rounded-(--cds-radius-sm) border text-caption leading-none font-semibold';
const NUM_OFF_CLS = 'bg-card text-content-tertiary';
const NUM_ON_CLS = 'border-transparent bg-primary text-primary-foreground';
const OPT_CLS =
  'h-auto w-full justify-start gap-2 whitespace-normal rounded-md border-border bg-transparent px-3 py-2.5 text-left text-ui leading-normal font-normal';
const OPT_SEL_CLS = 'border-ring bg-(--menu-hover)';
const OPT_TXT_CLS = 'min-w-0 flex-1';
const ROW_STATIC_CLS =
  'flex w-full items-center gap-2 rounded-md border border-border px-3 py-2.5 text-ui leading-normal text-foreground';

const STATUS_WAITING_INK = 'text-(--card-button)';
const QUESTION_STATUS: Record<
  ChiefQuestionItem['status'],
  { icon: LucideIcon; ink: string; label: string }
> = {
  pending: { icon: CircleHelp, ink: STATUS_WAITING_INK, label: '等你回答' },
  answered: { icon: CircleCheck, ink: 'text-content-tertiary', label: '已回答' },
  cancelled: { icon: Ban, ink: 'text-content-tertiary', label: '已取消' },
};

function QuestionStatus({ status }: { status: ChiefQuestionItem['status'] }) {
  const { t } = useI18n();
  const { icon: Icon, ink, label } = QUESTION_STATUS[status];
  return (
    <span
      data-testid="chief-question-status"
      className={`flex flex-none items-center gap-1 text-meta whitespace-nowrap ${ink}`}
    >
      <Icon aria-hidden strokeWidth={1.75} className="size-3.25" />
      {t(label)}
    </span>
  );
}

export function ChiefQuestionCard({ item, onAnswer, onCancel }: ChiefQuestionCardProps) {
  const { t } = useI18n();
  const pending = item.status === 'pending' && onAnswer !== undefined;
  const [drafts, setDrafts] = useState<Draft[]>(() => initialDrafts(item));
  const [step, setStep] = useState(0);
  const total = item.questions.length;
  const lastStep = total - 1;
  const last = step === lastStep;
  const question = item.questions[step] ?? item.questions[0];
  const draft = drafts[step];

  useLayoutEffect(() => {
    if (!pending || question === undefined || question.options.length === 0) return;
    const max = question.options.length + 1;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      )
        return;
      const n = Number.parseInt(e.key, 10);
      if (!Number.isInteger(n) || n < 1 || n > max) return;
      setDrafts((prev) => applyPick(prev, step, question, n - 1));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [pending, step, question]);

  const stepComplete = useMemo(() => draftComplete(draft, question), [draft, question]);
  const allComplete = useMemo(
    () => pending && item.questions.every((q, i) => draftComplete(drafts[i], q)),
    [pending, drafts, item.questions],
  );

  const submit = () => {
    if (!allComplete) return;
    onAnswer?.({
      requestId: item.requestId,
      answers: drafts.map((d, i) => {
        const header = item.questions[i]?.header ?? '';
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
          <span className="text-ui font-medium text-foreground">{t('总管提问')}</span>
          <QuestionStatus status={item.status} />
        </div>
        <div className="flex flex-col gap-3">
          {item.questions.map((q, qi) => (
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

  const scroll = question.options.length > 6;
  const pickedCount = draft?.kind === 'choices' ? draft.picked.length : 0;
  const otherSelected = draft?.kind === 'choices' && draft.other;
  const hintText =
    question.options.length === 0
      ? ''
      : question.multiSelect === true
        ? pickedCount > 0
          ? t('已选 {n} 项', { n: pickedCount })
          : t('未选')
        : t('数字键 1–{n} 选择', { n: question.options.length + 1 });

  return (
    <div data-testid="chief-question-card" data-status={item.status} className={CARD_CLS}>
      <div className="flex gap-1" aria-hidden="true">
        {item.questions.map((_, i) => (
          <span key={i} className={`${PIP_CLS}${i <= step ? ` ${PIP_ON_CLS}` : ''}`} />
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span data-testid="chief-question-step" className="text-caption text-content-tertiary">
          {question.header} · {step + 1}/{total}
        </span>
        <QuestionStatus status={item.status} />
      </div>
      <div data-testid="chief-question-text" className={BIG_CLS}>
        {question.question}
      </div>
      {question.options.length === 0 ? (
        <Input
          data-testid={`chief-question-input-${step}`}
          className={FORM_CONTROL_CLS}
          placeholder={t('输入你的回答')}
          value={draft?.kind === 'text' ? draft.value : ''}
          disabled={!pending}
          onChange={(e) => {
            const value = e.target.value;
            setDrafts((prev) => replaceDraft(prev, step, { kind: 'text', value }));
          }}
        />
      ) : (
        <div className={`flex flex-col gap-1.5${scroll ? ' max-h-54 overflow-y-auto pr-0.5' : ''}`}>
          {question.options.map((option, oi) => {
            const selected = draft?.kind === 'choices' && draft.picked.includes(option.label);
            return (
              <Button
                key={oi}
                variant="outline"
                size="sm"
                data-testid={`chief-question-option-${step}-${oi}`}
                disabled={!pending}
                aria-pressed={selected}
                title={option.description}
                className={`${OPT_CLS}${selected ? ` ${OPT_SEL_CLS}` : ''}`}
                onClick={() => setDrafts((prev) => applyPick(prev, step, question, oi))}
              >
                <span className={`${NUM_CLS} ${selected ? NUM_ON_CLS : NUM_OFF_CLS}`}>
                  {oi + 1}
                </span>
                <span className={OPT_TXT_CLS}>{option.label}</span>
              </Button>
            );
          })}
          <Button
            key="other"
            variant="outline"
            size="sm"
            data-testid={`chief-question-other-${step}`}
            disabled={!pending}
            aria-pressed={otherSelected}
            className={`${OPT_CLS}${otherSelected ? ` ${OPT_SEL_CLS}` : ''}`}
            onClick={() =>
              setDrafts((prev) => applyPick(prev, step, question, question.options.length))
            }
          >
            <span className={`${NUM_CLS} ${otherSelected ? NUM_ON_CLS : NUM_OFF_CLS}`}>
              {question.options.length + 1}
            </span>
            <span className={OPT_TXT_CLS}>{t('其他…')}</span>
          </Button>
          {otherSelected && (
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
                  return replaceDraft(prev, step, { ...current, otherText: value });
                });
              }}
            />
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          className={DIALOG_TEXT_BUTTON}
          disabled={!pending || onCancel === undefined}
          onClick={() => onCancel?.(item.requestId)}
        >
          {t('取消提问')}
        </Button>
        <span className={HINT_CLS}>{hintText}</span>
        {step > 0 && (
          <Button
            variant="ghost"
            className={DIALOG_TEXT_BUTTON}
            disabled={!pending}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            {t('上一步')}
          </Button>
        )}
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
            <span className={OPT_TXT_CLS}>{option.label}</span>
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

function initialDrafts(item: ChiefQuestionItem): Draft[] {
  return item.questions.map((q) =>
    q.options.length === 0
      ? { kind: 'text' as const, value: '' }
      : { kind: 'choices' as const, picked: [], other: false, otherText: '' },
  );
}

function applyPick(
  prev: Draft[],
  qi: number,
  question: ChiefQuestionItem['questions'][number],
  index: number,
): Draft[] {
  const current = prev[qi];
  if (current?.kind !== 'choices') return prev;
  if (index === question.options.length) {
    if (question.multiSelect === true)
      return replaceDraft(prev, qi, { ...current, other: !current.other });
    return replaceDraft(prev, qi, { ...current, picked: [], other: true });
  }
  const label = question.options[index]?.label;
  if (label === undefined) return prev;
  if (question.multiSelect === true) {
    const picked = current.picked.includes(label)
      ? current.picked.filter((l) => l !== label)
      : [...current.picked, label];
    return replaceDraft(prev, qi, { ...current, picked });
  }
  return replaceDraft(prev, qi, { ...current, picked: [label], other: false });
}

function draftComplete(
  draft: Draft | undefined,
  question: ChiefQuestionItem['questions'][number] | undefined,
): boolean {
  if (draft === undefined || question === undefined) return false;
  if (draft.kind === 'text') return draft.value.trim() !== '';
  return draft.picked.length >= 1 || (draft.other && draft.otherText.trim() !== '');
}

function replaceDraft(prev: Draft[], qi: number, next: Draft): Draft[] {
  const copy = [...prev];
  copy[qi] = next;
  return copy;
}
