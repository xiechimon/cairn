import { Bubble, BubbleContent } from '@cairn/web';

export const Variants = () => (
  <div style={{ width: 460, display: 'flex', flexDirection: 'column', gap: 8 }}>
    <Bubble variant="default"><BubbleContent>Open a PR for task #104 when CI is green.</BubbleContent></Bubble>
    <Bubble variant="secondary"><BubbleContent>Run the web e2e suite first.</BubbleContent></Bubble>
    <Bubble variant="muted"><BubbleContent>Implementer joined the thread</BubbleContent></Bubble>
    <Bubble variant="tinted"><BubbleContent>Plan drafted: 4 steps, est. 25 minutes.</BubbleContent></Bubble>
    <Bubble variant="outline"><BubbleContent>PR #212 is waiting on review.</BubbleContent></Bubble>
    <Bubble variant="destructive"><BubbleContent>Build #57 failed: typecheck reported 3 errors</BubbleContent></Bubble>
  </div>
);

export const Alignment = () => (
  <div style={{ width: 460, display: 'flex', flexDirection: 'column', gap: 8 }}>
    <Bubble variant="secondary" align="end">
      <BubbleContent>Can you retry the failed step?</BubbleContent>
    </Bubble>
    <Bubble variant="tinted">
      <BubbleContent>Retrying step 3 of build #57 on the same worktree.</BubbleContent>
    </Bubble>
  </div>
);
