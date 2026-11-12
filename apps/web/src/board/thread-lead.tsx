import { parseReplyQuote } from '@cairn/shared';
import { ReplyQuoteBlock } from '../chief/reply-quote-block.js';
import { UserMessageBubble } from '../components/chat/user-message-bubble.js';
import { ChatMarkdown } from '../detail/chat-markdown.js';
import { SpecBlock } from '../detail/spec-block.js';
import type { TodoRecord } from '../fixtures/records.js';
import { ThreadOriginLine } from './thread-origin-line.js';
import type { ThreadOrigin, ThreadUpdates } from './thread-panel-model.js';
import { ThreadUpdatesBlock } from './thread-updates-block.js';

export function ThreadLead({
  todo,
  showSpec,
  updates,
  origin,
  onJumpToOrigin,
}: {
  todo: TodoRecord;
  showSpec: boolean;
  updates: ThreadUpdates | null;
  origin: ThreadOrigin | null;
  onJumpToOrigin: () => void;
}) {
  const inherited = todo.request?.segments.some((segment) => segment.context !== undefined);
  const spec = todo.spec.trim();
  const purpose =
    showSpec &&
    inherited !== true &&
    spec !== '' &&
    spec !== todo.title.trim() &&
    spec !== origin?.text.trim();
  const legacyReply = purpose ? parseReplyQuote(spec) : null;
  return (
    <div data-testid="thread-lead" className="flex min-w-0 flex-col">
      {purpose && (
        <section
          data-testid="thread-purpose"
          className="spec-block chat-text min-w-0 text-ui leading-5 break-words text-foreground [&>*:not(.chat-md-block)]:max-w-[68ch] [&>.chat-md-block>*]:max-w-[68ch]"
        >
          {legacyReply !== null && <ReplyQuoteBlock quote={legacyReply.quote} />}
          <ChatMarkdown text={legacyReply?.body ?? spec} />
        </section>
      )}
      {updates !== null && <ThreadUpdatesBlock updates={updates} />}
      {showSpec && inherited === true && <SpecBlock spec={spec} request={todo.request} />}
      {origin !== null && (
        <div className="mt-5 flex flex-col items-end first:mt-0">
          {inherited !== true && (
            <UserMessageBubble
              data-testid="thread-request"
              className="chat-bubble max-w-[min(85%,42rem)] break-words whitespace-pre-wrap"
            >
              {origin.text}
            </UserMessageBubble>
          )}
          <ThreadOriginLine onJump={onJumpToOrigin} />
        </div>
      )}
    </div>
  );
}
