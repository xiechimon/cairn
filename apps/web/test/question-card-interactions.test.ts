import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { validateQuestionAnswers } from '../../server/src/services/chief-question-answers.js';
import { toast } from 'sonner';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { AnswerComposer } from '../src/chief/answer-composer.js';
import { type ChiefQuestionItem, QuestionCard, type QuestionCardProps } from '../src/chief/question-card.js';
import { answerKeyOf, questionDockState } from '../src/chief/question-dock-state.js';
import { questionDraftStore, questionSubmitStore } from '../src/chief/question-drafts.js';

const hooks = vi.hoisted(() => ({ effects: [] as Array<() => unknown> }));
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (effect: () => unknown) => hooks.effects.push(effect),
  useId: () => 'question-test',
  useMemo: (factory: () => unknown) => factory(),
  useRef: (current: unknown) => ({ current }),
  useState: (value: unknown) => [typeof value === 'function' ? value() : value, vi.fn()],
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('../src/i18n/provider.js', () => ({ useI18n: () => ({ t: (text: string) => text }) }));
vi.mock('sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('sonner')>()),
  toast: vi.fn(),
}));

const draftKey = 'question-card-interactions';
const item = (firstOptions: { label: string }[] = []): ChiefQuestionItem => ({
  kind: 'question',
  id: 'row-multi',
  requestId: 'q-multi',
  status: 'pending',
  parkedAt: 1000,
  answers: null,
  questions: [
    { header: 'Scope', question: 'Which pages?', options: firstOptions },
    { header: 'Format', question: 'Which format?', options: [{ label: 'CSV' }, { label: 'JSON' }] },
  ],
});

function element(tree: ReactNode, id: string, attribute = 'data-testid'): ReactElement<Record<string, unknown>> {
  const queue: unknown[] = [tree];
  while (queue.length > 0) {
    const node = queue.shift();
    if (Array.isArray(node)) {
      queue.push(...node);
      continue;
    }
    if (!isValidElement<Record<string, unknown>>(node)) continue;
    if (node.props[attribute] === id) return node;
    queue.push(node.props.children, node.props.trigger);
  }
  throw new Error(`Missing element: ${id}`);
}

class CardRow {
  constructor(readonly input: boolean) {}
  focus = vi.fn();
  matches = () => this.input;
  contains = () => false;
}

function setup(question = item()) {
  const onAnswer = vi.fn<NonNullable<QuestionCardProps['onAnswer']>>();
  const onCancel = vi.fn();
  const render = (bound = false) => {
    const tree = QuestionCard({ item: question, draftKey, onAnswer, onCancel, bound });
    const step = questionDraftStore.get(draftKey)?.step ?? 0;
    const rows = [
      ...question.questions[step]!.options.map(() => new CardRow(false)),
      new CardRow(true),
    ];
    const addEventListener = vi.fn<(type: string, listener: (event: unknown) => void) => void>();
    const card = element(tree, 'chief-question-chips');
    Object.assign(card.props.ref as { current: unknown }, {
      current: { addEventListener, querySelectorAll: () => rows },
    });
    for (const effect of hooks.effects.splice(0)) effect();
    return {
      key: (key: string, row: number, modifier?: 'metaKey' | 'ctrlKey') => {
        vi.stubGlobal('HTMLElement', CardRow);
        const preventDefault = vi.fn();
        addEventListener.mock.calls.find(([type]) => type === 'keydown')?.[1]({
          key, target: rows[row], preventDefault, ...(modifier === undefined ? {} : { [modifier]: true }),
        });
        return preventDefault;
      },
      row: (index: number) => rows[index],
      clickArrow: () => {
        const button = element(tree, 'chief-question-submit');
        if (button.props.disabled !== true) (button.props.onClick as () => void)();
      },
      value: () => element(tree, 'chief-question-other').props.value,
      type: (value: string) => (element(tree, 'chief-question-other').props.onChange as (event: { target: { value: string } }) => void)({ target: { value } }),
      submit: () => {
        const button = element(tree, 'chief-question-submit');
        expect(button.props.disabled).toBe(false);
        (button.props.onClick as () => void)();
      },
      skip: () => (element(tree, 'chief-question-skip').props.onClick as () => void)(),
      optionDisabled: (step: number) => element(tree, `chief-question-option-${step}-0`).props.disabled,
      choose: (step = 1) => {
        const option = element(tree, `chief-question-option-${step}-0`);
        const handler = option.props.onClick ?? element(option, '', 'data-question-row').props.onCheckedChange;
        (handler as () => void)();
      },
    };
  };
  return { onAnswer, onCancel, render };
}

afterEach(() => {
  hooks.effects.length = 0;
  vi.unstubAllGlobals();
  questionDraftStore.clearAll();
  questionSubmitStore.clearAll();
  questionDockState.clearPrimary('q-multi');
  for (const step of [0, 1]) {
    questionDockState.setAnswerText(answerKeyOf(draftKey, step), '');
  }
});

describe.each(['docked', 'parked'] as const)('%s card submission', (placement) => {
  const bound = placement === 'docked';
  const entries = ['option', 'Enter', 'Cmd+Enter', 'Ctrl+Enter', 'arrow', 'digit then Enter', 'composer Enter', 'composer send'] as const;
  const answers = ['single', 'multi', 'multi plus Other', 'Other only'] as const;

  test.each(entries.flatMap((entry) => answers.map((answer) => ({ entry, answer }))))('$entry / $answer', ({ entry, answer }) => {
    const single = answer === 'single';
    const other = answer === 'multi plus Other' || answer === 'Other only';
    const choice = answer !== 'Other only';
    const question = item([{ label: 'Dashboard' }, { label: 'Settings' }]);
    question.questions[1] = { ...question.questions[0]!, multiSelect: !single };
    const { render, onAnswer } = setup({ ...question, parkedAt: bound ? undefined : 1000 });
    render(true).choose(0);
    if (!single && choice && entry !== 'option') render(bound).choose();
    if (other) render(bound).type('  Also the changelog  ');
    const current = render(bound);
    let submits = true;

    switch (entry) {
      case 'option':
        current.choose();
        submits = single;
        break;
      case 'digit then Enter': {
        const row = other ? 2 : 0;
        expect(current.key(String(row + 1), -1)).toHaveBeenCalledOnce();
        expect(current.row(row)?.focus).toHaveBeenCalledOnce();
        expect(onAnswer).not.toHaveBeenCalled();
        if (other) expect(current.key('Enter', row)).toHaveBeenCalledOnce();
        else if (single && current.key('Enter', row).mock.calls.length === 0) current.choose();
        else submits = false;
        break;
      }
      case 'Enter':
        if (other) expect(current.key('Enter', 2)).toHaveBeenCalledOnce();
        else if (single && current.key('Enter', 0).mock.calls.length === 0) current.choose();
        else submits = false;
        break;
      case 'Cmd+Enter':
      case 'Ctrl+Enter':
        expect(current.key('Enter', other ? 2 : 0, entry === 'Cmd+Enter' ? 'metaKey' : 'ctrlKey')).toHaveBeenCalledOnce();
        submits = !single;
        break;
      case 'arrow':
        if (!single) current.clickArrow();
        else expect(() => current.clickArrow()).toThrow('Missing element: chief-question-submit');
        submits = !single;
        break;
      case 'composer Enter':
      case 'composer send': {
        const primary = questionDockState.primary();
        expect(primary?.enabled ?? false).toBe(bound && !single);
        if (bound) {
          const composer = AnswerComposer({
            active: true, answerKey: answerKeyOf(draftKey, 1), placeholder: '', above: null,
            onFocusEnter: vi.fn(), onFocusLeave: vi.fn(),
          });
          if (entry === 'composer Enter') composer.props.onAdvance?.();
          else if (composer.props.send?.enabled) composer.props.send.onClick?.();
        }
        submits = bound && !single;
        break;
      }
    }

    if (!submits) expect(onAnswer).not.toHaveBeenCalled();
    else expect(onAnswer).toHaveBeenCalledExactlyOnceWith({
      requestId: 'q-multi',
      answers: [
        { header: 'Scope', choices: ['Dashboard'] },
        { header: 'Scope', choices: [...(choice ? ['Dashboard'] : []), ...(other ? ['Also the changelog'] : [])] },
      ],
    });
  });
});

describe('one answer draft across card and composer', () => {
  const token = '![dashboard.csv](attachment:dashboard-export)';
  const singleQuestion = () => ({ ...item(), questions: [item().questions[1]!] });
  const composer = () => AnswerComposer({
    active: true, answerKey: answerKeyOf(draftKey, 0), placeholder: '', above: null,
    onFocusEnter: vi.fn(), onFocusLeave: vi.fn(),
  });

  test.each(['composer Enter', 'composer send', 'card submit'])('%s submits the visible revision and attachments, not the hidden card text', (entry) => {
    const { render, onAnswer } = setup(singleQuestion());
    render(true).type('Earlier scope');
    composer().props.binding.setDraft?.(`${token}\nOnly the dashboard`);
    const current = render(true);
    expect(current.value()).toBe('Only the dashboard');
    if (entry === 'card submit') current.submit();
    else if (entry === 'composer Enter') composer().props.onAdvance?.();
    else composer().props.send?.onClick?.();
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({
      requestId: 'q-multi', answers: [{ header: 'Format', choices: [`${token}\nOnly the dashboard`] }],
    });
  });

  test.each([true, false])('an explicit option with an attachment is one valid single choice (bound=%s)', (bound) => {
    const question = singleQuestion();
    const { render, onAnswer } = setup(question);
    composer().props.binding.setDraft?.(`${token}\nEarlier scope`);
    render(bound).choose(0);
    expect(onAnswer).toHaveBeenCalledOnce();
    const submission = onAnswer.mock.lastCall?.[0];
    expect(submission?.requestId).toBe(question.requestId);
    expect(validateQuestionAnswers(question.questions, submission?.answers ?? [])).toEqual([
      { header: 'Format', choices: [`${token}\nCSV`] },
    ]);
  });

  test('retrying the option after submission fails still sends its attachment', () => {
    const { render, onAnswer } = setup(singleQuestion());
    composer().props.binding.setDraft?.(`${token}\nEarlier scope`);
    render(true).choose(0);
    questionSubmitStore.patch(draftKey, { submitting: true, error: null });
    expect(render(true).optionDisabled(0)).toBe(true);
    questionSubmitStore.patch(draftKey, { submitting: false, error: 'Try again' });
    render(true).choose(0);
    expect(onAnswer).toHaveBeenCalledTimes(2);
    expect(onAnswer).toHaveBeenLastCalledWith({
      requestId: 'q-multi', answers: [{ header: 'Format', choices: [`${token}\nCSV`] }],
    });
  });

  test('a single choice with an attachment survives advancing to another question', () => {
    const { render, onAnswer } = setup(item([{ label: 'Dashboard' }]));
    composer().props.binding.setDraft?.(`${token}\nEarlier scope`);
    render(true).choose(0);
    expect(onAnswer).not.toHaveBeenCalled();
    render().choose();
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({
      requestId: 'q-multi', answers: [
        { header: 'Scope', choices: [`${token}\nDashboard`] },
        { header: 'Format', choices: ['CSV'] },
      ],
    });
  });

  test('clearing the composer clears the hidden card answer too', () => {
    const { render, onAnswer } = setup(singleQuestion());
    render(true).type('Earlier scope');
    composer().props.binding.setDraft?.('');
    render(true);
    expect(questionDockState.primary()?.enabled).toBe(false);
    composer().props.onAdvance?.();
    expect(onAnswer).not.toHaveBeenCalled();
    expect(render().value()).toBe('');
  });

  test.each([true, false])('editing the card preserves the composer attachment (bound=%s)', (bound) => {
    const { render, onAnswer } = setup(singleQuestion());
    composer().props.binding.setDraft?.(`${token}\nOriginal scope`);
    render(bound).type('Revised scope');
    expect(composer().props.binding.draft).toBe(`${token}\nRevised scope`);
    render(bound).submit();
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({
      requestId: 'q-multi', answers: [{ header: 'Format', choices: [`${token}\nRevised scope`] }],
    });
  });

  test.each(['option', 'Enter', 'arrow'])('parking during an upload blocks %s until the unmounted composer saves its result', async (entry) => {
    const { render, onAnswer } = setup(singleQuestion());
    render(true).type('Dashboard');
    const beforeUpload = render(true);
    let finish = (_tokens: string[]) => {};
    const upload = new Promise<string[]>((resolve) => { finish = resolve; });
    const uploadingComposer = AnswerComposer({
      active: true, answerKey: answerKeyOf(draftKey, 0), placeholder: '', above: null,
      onFocusEnter: vi.fn(), onFocusLeave: vi.fn(), onAttachment: () => upload,
    });
    const cleanups = hooks.effects.splice(0).map((effect) => effect());
    const pending = uploadingComposer.props.onAttachment!([]);
    try {
      beforeUpload.key('Enter', 1);
      const parked = render();
      expect(parked.optionDisabled(0)).toBe(true);
      if (entry === 'option') parked.choose(0);
      else if (entry === 'Enter') parked.key('Enter', 1);
      else parked.clickArrow();
      expect(onAnswer).not.toHaveBeenCalled();
      for (const cleanup of cleanups) if (typeof cleanup === 'function') cleanup();
    } finally {
      finish([token]);
      await pending;
    }
    expect(render().optionDisabled(0)).toBe(false);
    render().submit();
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({
      requestId: 'q-multi', answers: [{ header: 'Format', choices: [`${token}\nDashboard`] }],
    });
  });

  test('another request upload does not block this parked answer', () => {
    const { render, onAnswer } = setup(singleQuestion());
    questionDockState.beginUpload('another-request');
    try {
      expect(render().optionDisabled(0)).toBe(false);
      render().choose(0);
      expect(onAnswer).toHaveBeenCalledOnce();
    } finally {
      questionDockState.endUpload('another-request');
    }
  });
});

describe('each question step keeps its own answer', () => {
  test.each(['choice', 'text'])('a parked text step survives the final %s answer', (last) => {
    const { render, onAnswer } = setup();
    render().type('Only the dashboard');
    render().submit();
    expect(questionDraftStore.get(draftKey)?.step).toBe(1);
    if (last === 'choice') render().choose();
    else {
      render().type('Spreadsheet');
      render().submit();
    }
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({
      requestId: 'q-multi',
      answers: [
        { header: 'Scope', text: 'Only the dashboard' },
        { header: 'Format', choices: [last === 'choice' ? 'CSV' : 'Spreadsheet'] },
      ],
    });
  });

  test.each([false, true])('a composer answer survives advancing then parking (multiSelect=%s)', (multiSelect) => {
    const question = item([{ label: 'All pages' }]);
    question.questions[0]!.multiSelect = multiSelect;
    const { render, onAnswer } = setup(question);
    questionDockState.setAnswerText(answerKeyOf(draftKey, 0), 'Only the dashboard');
    render(true);
    const primary = questionDockState.primary();
    expect(primary?.enabled).toBe(true);
    primary?.advance();
    expect(questionDraftStore.get(draftKey)?.drafts[0]).toMatchObject({ other: true, otherText: 'Only the dashboard' });
    expect(questionDockState.answerText(answerKeyOf(draftKey, 0))).toBe('');
    render().choose();
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({
      requestId: 'q-multi',
      answers: [{ header: 'Scope', choices: ['Only the dashboard'] }, { header: 'Format', choices: ['CSV'] }],
    });
  });

  test('card text committed before parking beats the earlier composer draft', () => {
    const { render, onAnswer } = setup(item([{ label: 'All pages' }]));
    const first = answerKeyOf(draftKey, 0);
    questionDockState.setAnswerText(first, 'All public pages');
    render(true).type('Only the dashboard');
    render(true).submit();
    const cleared = questionDockState.answerText(first);
    questionDockState.setAnswerText(first, 'All public pages');
    render().choose();
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({
      requestId: 'q-multi',
      answers: [{ header: 'Scope', choices: ['Only the dashboard'] }, { header: 'Format', choices: ['CSV'] }],
    });
    expect(cleared).toBe('');
  });

  test('a parked card cannot send an answer while Skip can still be undone', () => {
    vi.useFakeTimers();
    const { render, onAnswer, onCancel } = setup({ ...item(), questions: [item().questions[1]!] });
    const beforeSkip = render();
    beforeSkip.skip();
    const undo = vi.mocked(toast).mock.lastCall?.[1]?.action;
    try {
      beforeSkip.choose(0);
      render().choose(0);
      expect(onAnswer).not.toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();
      expect(render().optionDisabled(0)).toBe(true);
    } finally {
      if (undo !== null && typeof undo === 'object' && 'onClick' in undo)
        undo.onClick({} as React.MouseEvent<HTMLButtonElement>);
      vi.useRealTimers();
    }
    expect(render().optionDisabled(0)).toBe(false);
    render().choose(0);
    expect(onAnswer).toHaveBeenCalledOnce();
  });

  test('a parked multi-select step retains both its selection and custom text', () => {
    const question = item([{ label: 'Dashboard' }, { label: 'Settings' }]);
    question.questions[0]!.multiSelect = true;
    const { render, onAnswer } = setup(question);
    questionDockState.setAnswerText(answerKeyOf(draftKey, 0), 'Also the changelog');
    render(true).choose(0);
    expect(render().value()).toBe('Also the changelog');
    render().submit();
    render().choose();
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({
      requestId: 'q-multi',
      answers: [{ header: 'Scope', choices: ['Dashboard', 'Also the changelog'] }, { header: 'Format', choices: ['CSV'] }],
    });
  });

  test('clearing parked composer text leaves the current step unanswered', () => {
    const { render, onAnswer } = setup(item([{ label: 'All pages' }]));
    questionDockState.setAnswerText(answerKeyOf(draftKey, 0), 'Original scope');
    render(true);
    render().type('');
    expect(render().value()).toBe('');
    expect(questionDraftStore.get(draftKey)?.step ?? 0).toBe(0);
    expect(onAnswer).not.toHaveBeenCalled();
  });

  test('parking the current step keeps composer text visible and lets the inline answer replace it', () => {
    const { render, onAnswer } = setup(item([{ label: 'All pages' }]));
    questionDockState.setAnswerText(answerKeyOf(draftKey, 0), 'Original scope');
    render(true);
    expect(render().value()).toBe('Original scope');
    render().type('Only the dashboard');
    render().submit();
    render().choose();
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({
      requestId: 'q-multi',
      answers: [{ header: 'Scope', choices: ['Only the dashboard'] }, { header: 'Format', choices: ['CSV'] }],
    });
  });
});
