import { Bubble, BubbleContent, ClaudeMark, Message, MessageAvatar, MessageContent, MessageFooter, MessageGroup, MessageHeader } from '@cairn/web';

const Thread = () => (
  <div style={{ width: 520 }}>
    <MessageGroup>
      <Message align="end">
        <MessageContent>
          <Bubble variant="secondary" align="end">
            <BubbleContent>Why did build #318 fail on the web shard?</BubbleContent>
          </Bubble>
          <MessageFooter>Read 14:02</MessageFooter>
        </MessageContent>
      </Message>
      <Message>
        <MessageAvatar style={{ width: 32, height: 32 }}>
          <ClaudeMark width={18} height={18} />
        </MessageAvatar>
        <MessageContent>
          <MessageHeader>Reviewer</MessageHeader>
          <Bubble variant="tinted">
            <BubbleContent>
              The e2e spec for the daily brief timed out waiting for the login banner. I pushed a fix to PR #2155 and re-ran shard 3.
            </BubbleContent>
          </Bubble>
          <MessageFooter>Claude Opus · 14:03</MessageFooter>
        </MessageContent>
      </Message>
    </MessageGroup>
  </div>
);

const AvatarAndHeader = () => (
  <div style={{ width: 480 }}>
    <Message>
      <MessageAvatar style={{ width: 32, height: 32 }}>
        <ClaudeMark width={18} height={18} />
      </MessageAvatar>
      <MessageContent>
        <MessageHeader>Implementer · Task #104</MessageHeader>
        <Bubble variant="ghost">
          <BubbleContent>Opened PR #2160 with the dark mode toggle. CI is running.</BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  </div>
);

export { AvatarAndHeader };
