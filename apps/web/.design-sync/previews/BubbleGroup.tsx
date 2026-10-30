import { Bubble, BubbleContent, BubbleGroup } from '@cairn/web';

export const Stacked = () => (
  <div style={{ width: 460 }}>
    <BubbleGroup>
      <Bubble variant="tinted"><BubbleContent>Picked up task #104.</BubbleContent></Bubble>
      <Bubble variant="tinted"><BubbleContent>Plan: add the toggle, persist the choice, cover it with an e2e case.</BubbleContent></Bubble>
      <Bubble variant="tinted"><BubbleContent>Starting step 1 of 3.</BubbleContent></Bubble>
    </BubbleGroup>
  </div>
);
