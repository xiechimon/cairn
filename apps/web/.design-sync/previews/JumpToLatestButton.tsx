import { JumpToLatestButton, MessageScroller, MessageScrollerContent, MessageScrollerProvider, MessageScrollerViewport } from '@cairn/web';

const LINES = [
  'Planner: split Task #104 into three steps.',
  'Implementer: created branch claude/dark-mode-toggle.',
  'Implementer: added ThemeToggle to settings page.',
  'Implementer: pnpm typecheck passed.',
  'Implementer: pushed 2 commits to origin.',
  'Implementer: opened PR #2156.',
  'Reviewer: checks started on PR #2156.',
  'Reviewer: lint passed.',
  'Reviewer: affected e2e passed (14 specs).',
  'Reviewer: approved, ready to merge.',
  'Implementer: rebased onto origin/main.',
  'Reviewer: re-ran checks after rebase.',
  'Reviewer: all checks green.',
  'Implementer: PR #2156 merged.',
  'Planner: Task #104 marked done.',
  'Planner: queued Task #105.',
];

export const Scrolled = () => (
  <div style={{ width: 420, height: 200, position: 'relative' }}>
    <MessageScrollerProvider defaultScrollPosition="start">
      <MessageScroller>
        <MessageScrollerViewport>
          <MessageScrollerContent style={{ gap: 12, padding: 12 }}>
            {LINES.map((l) => (
              <div key={l} style={{ fontSize: 13 }}>{l}</div>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <JumpToLatestButton>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></svg>
          <span className="sr-only">Scroll to latest</span>
        </JumpToLatestButton>
      </MessageScroller>
    </MessageScrollerProvider>
  </div>
);
