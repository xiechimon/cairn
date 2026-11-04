import { Bubble, BubbleContent, Message, MessageContent, MessageGroup, MessageHeader } from '@cairn/web';

export const Conversation = () => (
  <div style={{ width: 520 }}>
    <MessageGroup>
      <Message align="end">
        <MessageContent>
          <Bubble variant="secondary" align="end">
            <BubbleContent>Add a dark mode toggle to the settings page and open a PR.</BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
      <Message>
        <MessageContent>
          <MessageHeader>Chief</MessageHeader>
          <Bubble variant="ghost">
            <BubbleContent>
              I created task #104 in cairn and assigned it to the implementer. It will run the web e2e suite before opening the PR, and I will report back when CI is green.
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    </MessageGroup>
  </div>
);

export const Variants = () => (
  <div style={{ width: 520, display: 'flex', flexDirection: 'column', gap: 8 }}>
    <Bubble variant="default"><BubbleContent>Default bubble</BubbleContent></Bubble>
    <Bubble variant="muted"><BubbleContent>Muted bubble for system notes</BubbleContent></Bubble>
    <Bubble variant="tinted"><BubbleContent>Tinted bubble for agent replies</BubbleContent></Bubble>
    <Bubble variant="outline"><BubbleContent>Outline bubble</BubbleContent></Bubble>
    <Bubble variant="destructive"><BubbleContent>Build failed: typecheck reported 3 errors</BubbleContent></Bubble>
  </div>
);
