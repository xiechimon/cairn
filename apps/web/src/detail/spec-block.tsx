import {
  parseReplyQuote,
  renderAttachmentTokensToLabels,
  renderTaskText,
  segmentKey,
  type TaskRequest,
  type TaskSegment,
} from '@cairn/shared';
import { cn } from 'cn';
import { Link } from 'react-router';
import { ReplyQuoteBlock } from '../chief/reply-quote-block.js';
import { StatusLine } from '../components/chat/status-line.js';
import { UserMessageBubble } from '../components/chat/user-message-bubble.js';
import { Message, MessageContent } from '../components/ui/message.js';
import { useI18n } from '../i18n/provider.js';
import { ChatMarkdown } from './chat-markdown.js';

interface SpecBlockProps {
  spec: string;
  className?: string;
  request?: TaskRequest | null;
}

export function SpecBlock({ spec, className, request }: SpecBlockProps) {
  const { t } = useI18n();
  const inherited = request?.segments.some((segment) => segment.context !== undefined) ?? false;
  const legacyReply = parseReplyQuote(spec);
  if (!inherited)
    return (
      <section
        className={cn(
          'spec-block mt-4 mx-4 rounded-lg border border-(--border) bg-(--secondary) px-4 py-3 text-card-title break-words text-(--foreground) [&>*:not(.chat-md-block)]:max-w-[68ch] [&>.chat-md-block>*]:max-w-[68ch]',
          className,
        )}
      >
        {legacyReply !== null && <ReplyQuoteBlock quote={legacyReply.quote} />}
        <ChatMarkdown text={legacyReply?.body ?? spec} />
      </section>
    );
  const seen = new Set<string>();
  const rows: {
    id: string;
    messageId: string;
    threadId: string;
    role: TaskSegment['author'] | 'coordinator';
    text: string;
  }[] = [];
  for (const [index, segment] of (request?.segments ?? []).entries()) {
    for (const message of segment.author === 'owner' ? (segment.context?.messages ?? []) : []) {
      const id = `${message.threadId}:${message.messageId}`;
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push({ ...message, id, role: message.role === 'user' ? 'owner' : 'coordinator' });
    }
    const threadId =
      segment.source.kind === 'chat'
        ? segment.source.threadId
        : (segment.context?.messages[0]?.threadId ?? 'request');
    const messageId =
      segment.source.kind === 'chat' ? segment.source.messageId : segmentKey(segment.source);
    const id =
      segment.source.span === 'quote'
        ? `${threadId}:${messageId}:quote:${index}`
        : `${threadId}:${messageId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push({
      id,
      threadId,
      messageId,
      role: segment.author,
      text:
        segment.author === 'third-party' ? renderTaskText({ segments: [segment] }) : segment.text,
    });
  }
  return (
    <section
      aria-label={`${t('来源：')}${t('Coordinator')}`}
      className={cn('spec-block mt-4 flex min-w-0 flex-col gap-4', className)}
    >
      <StatusLine>
        {t('来源：')}
        {t('Coordinator')}
      </StatusLine>
      {request?.segments.some((segment) => segment.context?.incomplete) && (
        <p role="status" className="m-0 text-meta text-content-secondary">
          {t('来源未通过校验。')}{' '}
          <Link to="/app" className="underline underline-offset-3">
            {t('给 Coordinator 发消息')}
          </Link>
        </p>
      )}
      {rows.map((row) => {
        const text =
          row.role === 'coordinator' ? renderAttachmentTokensToLabels(row.text) : row.text;
        const reply = parseReplyQuote(text);
        const source = rows.find(
          (candidate) =>
            candidate.messageId === reply?.sourceMessageId && candidate.threadId === row.threadId,
        );
        const MessageBody = row.role === 'owner' ? UserMessageBubble : 'div';
        return (
          <Message
            key={row.id}
            id={`request-context-${row.id}`}
            data-role={row.role}
            align={row.role === 'owner' ? 'end' : 'start'}
            className="scroll-mt-4"
          >
            <MessageContent className={row.role === 'owner' ? 'items-end gap-0' : 'gap-1'}>
              {row.role === 'coordinator' && (
                <span className="text-meta text-content-tertiary">{t('Coordinator')}</span>
              )}
              <MessageBody
                className={cn(
                  row.role === 'owner'
                    ? 'chat-bubble max-w-[min(85%,42rem)] break-words'
                    : 'min-w-0 text-card-title break-words text-foreground voice-response w-full',
                )}
              >
                {reply !== null && (
                  <ReplyQuoteBlock
                    quote={reply.quote}
                    {...(source === undefined
                      ? {}
                      : { sourceHref: `#${encodeURIComponent(`request-context-${source.id}`)}` })}
                  />
                )}
                <ChatMarkdown text={reply?.body ?? text} />
              </MessageBody>
            </MessageContent>
          </Message>
        );
      })}
    </section>
  );
}
