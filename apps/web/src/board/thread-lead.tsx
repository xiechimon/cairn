import { parseReplyQuote } from '@cairn/shared';
import { ReplyQuoteBlock } from '../chief/reply-quote-block.js';
import { ChatMarkdown } from '../detail/chat-markdown.js';
import { SpecBlock } from '../detail/spec-block.js';
import type { TodoRecord } from '../fixtures/records.js';
import { ThreadOriginLine } from './thread-origin-line.js';
import type { ThreadOrigin } from './thread-panel-model.js';

export function ThreadLead({
  todo,
  showSpec,
  origin,
  onJumpToOrigin,
}: {
  todo: TodoRecord;
  showSpec: boolean;
  origin: ThreadOrigin | null;
  onJumpToOrigin: () => void;
}) {
  const inherited = todo.request?.segments.some((segment) => segment.context !== undefined);
  const spec = todo.spec.trim();
  const purpose = showSpec && inherited !== true && spec !== '' && spec !== todo.title.trim();
  const legacyReply = purpose ? parseReplyQuote(spec) : null;
  const jump = origin !== null && todo.sourceKind !== 'orchestration';
  return (
    <div data-testid="thread-lead" className="flex min-w-0 flex-col">
      {purpose && (
        <section
          data-testid="thread-purpose"
          className="spec-block chat-text min-w-0 text-ui leading-5 break-words text-foreground [&_blockquote]:text-foreground [&>*:not(.chat-md-block)]:max-w-[68ch] [&>.chat-md-block>*]:max-w-[68ch]"
        >
          {legacyReply !== null && <ReplyQuoteBlock quote={legacyReply.quote} />}
          <ChatMarkdown text={legacyReply?.body ?? spec} />
        </section>
      )}
      {showSpec && inherited === true && <SpecBlock spec={spec} request={todo.request} />}
      {jump && <ThreadOriginLine onJump={onJumpToOrigin} />}
    </div>
  );
}
