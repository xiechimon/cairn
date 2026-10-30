import { useState } from 'react';
import { Badge } from '../components/ui/badge.js';
import { Bubble, BubbleContent } from '../components/ui/bubble.js';
import { Button } from '../components/ui/button.js';
import { Message, MessageContent, MessageFooter } from '../components/ui/message.js';
import { MessageScrollerItem } from '../components/ui/message-scroller.js';
import { toastError } from '../components/ui/toaster.js';
import { useI18n } from '../i18n/provider.js';
import { ChatMarkdown } from './chat-markdown.js';

export function QueuedMessages({
  messages,
  onSteer,
  onCancel,
}: {
  messages: { id: string; content: string; error?: string | null }[];
  onCancel?: (id: string, content: string) => Promise<unknown>;
  onSteer?: (id: string, content: string) => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [sending, setSending] = useState<string | null>(null);
  return messages.map((message) => (
    <MessageScrollerItem key={message.id} messageId={message.id}>
      <Message align="end" className="mt-3.5" data-testid="queued-message">
        <MessageContent>
          <Bubble variant="secondary" align="end">
            <BubbleContent data-testid="user-bubble">
              <ChatMarkdown text={message.content} />
            </BubbleContent>
          </Bubble>
          {message.error && (
            <p data-testid="queued-message-error" className="text-meta text-destructive">
              {message.error}
            </p>
          )}
          <MessageFooter className="gap-2">
            <Badge variant="secondary" data-testid="queued-badge">
              {t('排队中')}
            </Badge>
            {onCancel && (
              <Button
                variant="ghost"
                size="sm"
                disabled={sending !== null}
                data-testid="cancel-queued-message"
                onClick={() => {
                  setSending(message.id);
                  void onCancel(message.id, message.content)
                    .catch((error: unknown) => toastError(t('取消失败，请重试。'), error))
                    .finally(() => setSending(null));
                }}
              >
                {t('取消')}
              </Button>
            )}
            {onSteer && (
              <Button
                variant="ghost"
                size="sm"
                disabled={sending !== null}
                data-testid="steer-queued-message"
                onClick={() => {
                  setSending(message.id);
                  void onSteer(message.id, message.content)
                    .catch((error: unknown) => toastError(t('插话失败，请重试。'), error))
                    .finally(() => setSending(null));
                }}
              >
                {t('现在插话')}
              </Button>
            )}
          </MessageFooter>
        </MessageContent>
      </Message>
    </MessageScrollerItem>
  ));
}
