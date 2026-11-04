import {
  Bubble,
  BubbleContent,
  FadeScrollerViewport,
  Message,
  MessageContent,
  MessageHeader,
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerProvider,
} from '@cairn/web';

const lines = [
  'Picked up task #104 in cairn.',
  'Plan: add the toggle, persist the choice, cover it with an e2e case.',
  'Step 1: added ThemeToggle to the settings page.',
  'Step 2: stored the choice in local storage and applied it on load.',
  'Step 3: wrote settings-theme.spec.ts; it passes locally.',
  'Typecheck and lint are green.',
  'Opened PR #212 and requested review from Reviewer.',
  'CI is running the web e2e suite on four shards.',
];

export const Transcript = () => (
  <div style={{ width: 460, height: 260, display: 'flex' }}>
    <MessageScrollerProvider defaultScrollPosition="start">
      <MessageScroller>
        <FadeScrollerViewport>
          <MessageScrollerContent>
            {lines.map((line) => (
              <Message key={line}>
                <MessageContent>
                  <MessageHeader>Implementer</MessageHeader>
                  <Bubble variant="ghost">
                    <BubbleContent>{line}</BubbleContent>
                  </Bubble>
                </MessageContent>
              </Message>
            ))}
          </MessageScrollerContent>
        </FadeScrollerViewport>
      </MessageScroller>
    </MessageScrollerProvider>
  </div>
);
