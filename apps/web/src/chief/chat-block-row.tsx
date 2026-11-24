import { cn } from 'cn';
import type { CSSProperties } from 'react';
import { ChatChartBlock, ChatChartSkeleton } from '../components/chat/chat-chart.js';
import { DiffGlanceBlock, DiffGlanceSkeleton } from '../components/chat/diff-glance.js';
import { Message, MessageContent } from '../components/ui/message.js';
import { MessageScrollerItem } from '../components/ui/message-scroller.js';
import type { ChiefStreamItem } from '../fixtures/records.js';

type ChatBlockItem = Extract<ChiefStreamItem, { kind: 'chat-block' }>;

const SCROLLER_ITEM_STYLE: CSSProperties = { contentVisibility: 'visible' };

function ChatBlockBody({ item }: { item: ChatBlockItem }) {
  if (item.state === 'pending')
    return item.tool === 'diff' ? (
      <DiffGlanceSkeleton path={item.path ?? null} />
    ) : (
      <ChatChartSkeleton />
    );
  const block = item.block;
  if (block === undefined) return null;
  return block.block === 'diff' ? (
    <DiffGlanceBlock glance={block.glance} />
  ) : (
    <ChatChartBlock chart={block.chart} />
  );
}

export function ChatBlockRow({
  item,
  joinsPrev,
  joinsNext,
}: {
  item: ChatBlockItem;
  joinsPrev: boolean;
  joinsNext: boolean;
}) {
  if (item.state === 'failed') return null;
  return (
    <MessageScrollerItem messageId={item.id} style={SCROLLER_ITEM_STYLE}>
      <Message
        className={cn(joinsPrev ? 'mt-4' : 'mt-6', joinsNext && 'mb-3')}
        data-testid="chief-chat-block"
        data-block={item.tool}
        data-state={item.state}
      >
        <MessageContent className="relative min-w-0 flex-1 gap-0">
          <ChatBlockBody item={item} />
        </MessageContent>
      </Message>
    </MessageScrollerItem>
  );
}
