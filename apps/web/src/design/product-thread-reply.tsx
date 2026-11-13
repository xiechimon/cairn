import { useState } from 'react';
import { ThreadCard } from '../components/thread/thread-card.js';
import { ThreadReply, type ThreadReplyDelivery } from '../components/thread/thread-reply.js';
import { Labeled, Section, Specimen } from './specimen.js';

const CARDS: readonly {
  seq: number;
  title: string;
  tone: 'waiting' | 'review' | 'failed';
  reason: string;
  delivery: ThreadReplyDelivery;
}[] = [
  {
    seq: 7,
    title: 'Split the routing migration',
    tone: 'waiting',
    reason: 'Plan ready. Approve to start.',
    delivery: 'revision',
  },
  {
    seq: 12,
    title: 'Fix the orb /work permission',
    tone: 'failed',
    reason: 'Failed. Open it to retry.',
    delivery: 'restart',
  },
];

const send = () => new Promise<void>((resolve) => window.setTimeout(resolve, 400));

function CardWithReply({
  card,
  initiallyOpen,
}: {
  card: (typeof CARDS)[number];
  initiallyOpen: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <div className="w-160">
      <ThreadCard
        title={card.title}
        tone={card.tone}
        stateLabel="Needs you"
        reason={card.reason}
        primaryLabel={open ? 'Collapse' : 'Reply'}
        onPrimary={() => setOpen(!open)}
        footer={open ? <ThreadReply delivery={card.delivery} onSend={send} /> : null}
      />
    </div>
  );
}

export function ProductThreadReplySection() {
  return (
    <Section
      id="product-thread-reply"
      title="Thread reply"
      lede="A needs-you card on the home replies straight to its thread. Reply opens ThreadReply inside the card; the hint says how the thread takes it (plan feedback, a rerun, or a note into the running turn). The Coordinator only gets a note."
    >
      <Specimen
        id="reply-on-a-needs-you-card"
        title="Reply on a needs-you card"
        note="ThreadCard footer + ThreadReply"
        stage="canvas"
        className="flex-col"
      >
        {CARDS.map((card, index) => (
          <Labeled
            key={card.seq}
            label={`#${card.seq} · ${card.delivery}${index === 0 ? ' · open' : ''}`}
          >
            <CardWithReply card={card} initiallyOpen={index === 0} />
          </Labeled>
        ))}
      </Specimen>
    </Section>
  );
}
