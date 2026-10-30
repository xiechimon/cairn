import { Bubble, BubbleContent } from '@cairn/web';

export const LongContent = () => (
  <div style={{ width: 460 }}>
    <Bubble variant="tinted">
      <BubbleContent>
        Task #104 is merged. The reviewer approved PR #212 after the e2e suite passed on all four shards, and the branch feat/dark-mode-toggle was deleted.
      </BubbleContent>
    </Bubble>
  </div>
);

export const AsButton = () => (
  <div style={{ width: 460 }}>
    <Bubble variant="outline">
      <BubbleContent render={<button type="button" />}>Open build #57 log</BubbleContent>
    </Bubble>
  </div>
);
