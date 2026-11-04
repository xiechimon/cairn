import {
  Bubble,
  BubbleContent,
  Message,
  MessageContent,
  MessageHeader,
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@cairn/web';

const messages = [
  { id: 'm1', from: 'you', text: 'Add a dark mode toggle to the settings page and open a PR.' },
  { id: 'm2', from: 'Chief', text: 'Created task #104 in cairn and assigned it to the implementer.' },
  { id: 'm3', from: 'Implementer', text: 'Branch claude/dark-mode-toggle is up. Running pnpm typecheck and the affected e2e set now.' },
  { id: 'm4', from: 'Implementer', text: 'Typecheck passed. 12 of 12 affected e2e specs are green.' },
  { id: 'm5', from: 'Reviewer', text: 'Reviewed PR #2156: one finding about the missing i18n key, fixed in the follow-up commit.' },
  { id: 'm6', from: 'Chief', text: 'PR #2156 is merged into main. Task #104 is done.' },
];

function ChatThread({ position }: { position: 'start' | 'end' }) {
  return (
    <MessageScrollerProvider defaultScrollPosition={position} autoScroll={false}>
      <div style={{ width: 460, height: 300, position: 'relative', border: '1px solid var(--border)', borderRadius: 8 }}>
        <MessageScroller>
          <MessageScrollerViewport>
            <MessageScrollerContent style={{ padding: 16 }}>
              {messages.map((m) => (
                <MessageScrollerItem key={m.id} messageId={m.id}>
                  <Message align={m.from === 'you' ? 'end' : undefined}>
                    <MessageContent>
                      {m.from === 'you' ? null : <MessageHeader>{m.from}</MessageHeader>}
                      <Bubble variant={m.from === 'you' ? 'secondary' : 'ghost'} align={m.from === 'you' ? 'end' : undefined}>
                        <BubbleContent>{m.text}</BubbleContent>
                      </Bubble>
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton direction={position === 'start' ? 'end' : 'start'} />
        </MessageScroller>
      </div>
    </MessageScrollerProvider>
  );
}

export const JumpToLatest = () => <ChatThread position="start" />;

export const JumpToStart = () => <ChatThread position="end" />;
