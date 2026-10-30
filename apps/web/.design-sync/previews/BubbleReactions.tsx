import { Bubble, BubbleContent, BubbleReactions } from '@cairn/web';

export const Reactions = () => (
  <div style={{ width: 460, display: 'flex', flexDirection: 'column', gap: 28, paddingBottom: 16 }}>
    <Bubble variant="tinted">
      <BubbleContent>PR #212 merged into main. Task #104 is done.</BubbleContent>
      <BubbleReactions>👍 2</BubbleReactions>
    </Bubble>
    <Bubble variant="secondary" align="end">
      <BubbleContent>Ship it after the nightly e2e run.</BubbleContent>
      <BubbleReactions align="start">✓ 1</BubbleReactions>
    </Bubble>
  </div>
);
