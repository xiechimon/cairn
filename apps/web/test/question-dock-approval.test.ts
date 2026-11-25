import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { MinimizedQuestionState } from '../src/chief/chief-question.js';
import type { ChiefRootApi } from '../src/chief/chief-root.js';
import type { ChiefQuestionItem } from '../src/chief/question-item.js';
import type { OriginChiefQuestion } from '../src/chief/question-origin.js';
import { I18nProvider } from '../src/i18n/provider.js';

let mockRoot: ChiefRootApi | null = null;

vi.mock('../src/chief/chief-root.js', () => ({
  useOptionalChiefRoot: () => mockRoot,
}));

const {
  ChiefQuestion,
  QuestionRestoreButton,
  QuestionScopeContext,
  useAnswerKey,
  useMinimizedQuestion,
  useQuestionPending,
} = await import('../src/chief/chief-question.js');
const { questionDockState } = await import('../src/chief/question-dock-state.js');

function makeQuestion(requestId: string, question: string): ChiefQuestionItem {
  return {
    kind: 'question',
    id: requestId,
    requestId,
    status: 'pending',
    questions: [
      {
        header: requestId.startsWith('approval-') ? '审批' : 'Model',
        question,
        options: requestId.startsWith('approval-')
          ? [{ label: '批准执行' }, { label: '不执行' }]
          : [{ label: 'Claude' }, { label: 'Codex' }],
      },
    ],
    answers: null,
  };
}

function makeOrigin(conversationId: string, item: ChiefQuestionItem): OriginChiefQuestion {
  return {
    teamId: 't1',
    conversationId,
    origin: conversationId,
    item,
  };
}

function setChannel(threadId: string, items: ChiefQuestionItem[]): void {
  mockRoot = {
    surface: {
      load: 'ready',
      retry: () => {},
      chiefData: {
        bound: true,
        threadId,
        threadTitle: threadId,
        stream: items,
      },
      chiefUnread: 0,
      chiefBusy: false,
      chiefFresh: false,
    },
    pendingQuestions: items.map((item) => makeOrigin(threadId, item)),
  };
}

function readHooks(scope: ReadonlySet<string> | null = null): {
  answerKey: string | null;
  pending: boolean;
  minimized: MinimizedQuestionState | null;
} {
  let answerKey: string | null = 'unset';
  let pending = false;
  let minimized: MinimizedQuestionState | null = null;

  function Probe() {
    answerKey = useAnswerKey();
    pending = useQuestionPending();
    minimized = useMinimizedQuestion();
    return null;
  }

  renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLocale: 'zh',
      children: createElement(QuestionScopeContext.Provider, {
        value: scope,
        children: createElement(Probe),
      }),
    }),
  );
  return { answerKey, pending, minimized };
}

function renderDock(scope: ReadonlySet<string> | null = null): string {
  return renderToStaticMarkup(
    createElement(I18nProvider, {
      initialLocale: 'zh',
      children: createElement(QuestionScopeContext.Provider, {
        value: scope,
        children: createElement(ChiefQuestion),
      }),
    }),
  );
}

afterEach(() => {
  mockRoot = null;
  questionDockState.resetScopes();
});

describe('approval card composer isolation', () => {
  test('pending approval request does not bind useAnswerKey so bottom composer stays a normal chat composer', () => {
    setChannel('thread-home', [
      makeQuestion('approval-shell-1', 'Coordinator 想在 Mac 上不经沙箱运行这条命令：ls -la'),
    ]);
    const state = readHooks();
    expect(state.pending).toBe(true);
    expect(state.answerKey).toBeNull();
    const html = renderDock();
    expect(html).toContain('data-testid="approval-card"');
  });

  test('regular pending question binds useAnswerKey while expanded', () => {
    setChannel('thread-home', [makeQuestion('ask-1', 'Which model should we use?')]);
    const state = readHooks();
    expect(state.pending).toBe(true);
    expect(state.answerKey).not.toBeNull();
  });

  test('mixed approval and regular question only binds useAnswerKey on the regular question', () => {
    setChannel('thread-home', [
      makeQuestion('approval-1', 'Coordinator 想在 Mac 上不经沙箱运行这条命令：pwd'),
      makeQuestion('ask-2', 'Which branch?'),
    ]);
    expect(readHooks().answerKey).toBeNull();
    questionDockState.setFocus(1, 'thread-home');
    expect(readHooks().answerKey).not.toBeNull();
    questionDockState.setFocus(0, 'thread-home');
    expect(readHooks().answerKey).toBeNull();
  });
});

describe('minimized question dock behavior', () => {
  test('minimizing a regular question releases useAnswerKey while keeping questionPending and restore metadata', () => {
    setChannel('thread-home', [makeQuestion('ask-1', 'Which **model** should we use?')]);
    questionDockState.minimize('thread-home');
    const state = readHooks();
    expect(state.pending).toBe(true);
    expect(state.answerKey).toBeNull();
    expect(renderDock()).toBe('');
    expect(state.minimized).toEqual({
      placeholder: 'Which model should we use?',
      restore: expect.any(Function),
    });
    state.minimized?.restore();
    expect(readHooks().answerKey).not.toBeNull();
    expect(renderDock()).toContain('data-testid="chief-question"');
  });

  test('minimizing an approval card exposes restore with null placeholder so chat placeholder stays normal', () => {
    setChannel('thread-home', [
      makeQuestion('approval-2', 'Coordinator 想在 Mac 上不经沙箱运行这条命令：pwd'),
    ]);
    questionDockState.minimize('thread-home');
    const state = readHooks();
    expect(state.pending).toBe(true);
    expect(state.answerKey).toBeNull();
    expect(renderDock()).toBe('');
    expect(state.minimized).toEqual({
      placeholder: null,
      restore: expect.any(Function),
    });
    state.minimized?.restore();
    expect(renderDock()).toContain('data-testid="approval-card"');
  });

  test('restore button renders the chief-question-restore control', () => {
    const html = renderToStaticMarkup(
      createElement(I18nProvider, {
        initialLocale: 'zh',
        children: createElement(QuestionRestoreButton, { onClick: () => {} }),
      }),
    );
    expect(html).toContain('data-testid="chief-question-restore"');
    expect(html).toContain('aria-label="展开提问"');
  });
});

describe('cross-channel minimized and focus isolation', () => {
  test('minimizing in project A does not hide pending questions in home or project B', () => {
    const scopeA = new Set(['ask-a1']);
    const scopeB = new Set(['ask-b1']);
    setChannel('thread-proj-a', [makeQuestion('ask-a1', 'Question in A')]);
    questionDockState.minimize('thread-proj-a:scoped');
    expect(readHooks(scopeA).answerKey).toBeNull();
    expect(renderDock(scopeA)).toBe('');

    setChannel('thread-home', [makeQuestion('ask-h1', 'Question in Home')]);
    expect(readHooks(null).answerKey).not.toBeNull();
    expect(renderDock(null)).toContain('Question in Home');

    setChannel('thread-proj-b', [makeQuestion('ask-b1', 'Question in B')]);
    expect(readHooks(scopeB).answerKey).not.toBeNull();
    expect(renderDock(scopeB)).toContain('Question in B');

    setChannel('thread-proj-a', [makeQuestion('ask-a1', 'Question in A')]);
    expect(readHooks(scopeA).answerKey).toBeNull();
    expect(renderDock(scopeA)).toBe('');
  });

  test('focus index is isolated per channel scope and active scope backs default calls', () => {
    questionDockState.setFocus(1, 'thread-proj-a');
    expect(questionDockState.focus('thread-proj-a')).toBe(1);
    expect(questionDockState.focus('thread-proj-b')).toBe(0);
    expect(questionDockState.focus('thread-home')).toBe(0);

    questionDockState.setScope('thread-proj-b');
    questionDockState.minimize();
    questionDockState.setFocus(2);
    expect(questionDockState.minimized('thread-proj-b')).toBe(true);
    expect(questionDockState.focus('thread-proj-b')).toBe(2);
    expect(questionDockState.minimized('thread-proj-a')).toBe(false);
    expect(questionDockState.focus('thread-proj-a')).toBe(1);
    questionDockState.reveal();
    expect(questionDockState.minimized('thread-proj-b')).toBe(false);
  });
});
