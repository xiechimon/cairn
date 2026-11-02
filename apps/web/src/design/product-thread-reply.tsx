import { useState } from 'react';
import { ComposerTarget } from '../chief/composer-target.js';
import { ThreadCard } from '../components/thread/thread-card.js';
import { ThreadReply, type ThreadReplyDelivery } from '../components/thread/thread-reply.js';
import { Button } from '../components/ui/button.js';
import { Textarea } from '../components/ui/textarea.js';
import { Labeled, Section, Specimen } from './specimen.js';

const COMPOSER_SHELL =
  'rounded-(--radius-composer) border-0 bg-card px-3.5 pt-3 pb-2.5 shadow-(--shadow-composer)';
const COMPOSER_INPUT =
  'h-9 min-h-0 resize-none rounded-none border-none bg-transparent px-0.5 pt-0.5 pb-2.5 font-sans text-card-title shadow-none focus-visible:ring-0 dark:bg-transparent';

const CARDS: readonly {
  seq: number;
  title: string;
  tone: 'waiting' | 'review' | 'failed';
  reason: string;
  primary?: string;
  delivery: ThreadReplyDelivery;
}[] = [
  {
    seq: 7,
    title: 'Split the routing migration',
    tone: 'waiting',
    reason: '计划已就绪，批准后开工。',
    primary: '看计划',
    delivery: 'revision',
  },
  {
    seq: 12,
    title: 'Fix the orb /work permission',
    tone: 'failed',
    reason: '失败了，打开它重试。',
    delivery: 'restart',
  },
];

const send = () => new Promise<void>((resolve) => window.setTimeout(resolve, 400));

function CardWithToggle({ card }: { card: (typeof CARDS)[number] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex w-160 flex-col gap-2">
      <ThreadCard
        title={card.title}
        tone={card.tone}
        stateLabel="needs you"
        reason={card.reason}
        primaryLabel={open ? '收起' : '回复'}
        onPrimary={() => setOpen(!open)}
        viewLabel="看 thread"
        footer={
          open ? (
            <ThreadReply seq={card.seq} delivery={card.delivery} onSend={send} autoFocus />
          ) : null
        }
      />
    </div>
  );
}

function CardWithReply({ card }: { card: (typeof CARDS)[number] }) {
  return (
    <div className="flex w-160 flex-col gap-2">
      <ThreadCard
        title={card.title}
        tone={card.tone}
        stateLabel="needs you"
        reason={card.reason}
        {...(card.primary != null ? { primaryLabel: card.primary } : {})}
        viewLabel="看 thread"
        footer={<ThreadReply seq={card.seq} delivery={card.delivery} onSend={send} />}
      />
    </div>
  );
}

function Composer({ inside }: { inside: boolean }) {
  const [target, setTarget] = useState(true);
  const chip = target ? (
    <ComposerTarget seq={7} title="Split the routing migration" onClear={() => setTarget(false)} />
  ) : null;
  return (
    <div className="flex w-160 flex-col gap-2">
      {!inside && chip}
      <div className={COMPOSER_SHELL}>
        {inside && chip != null && <div className="mb-2">{chip}</div>}
        <Textarea
          className={COMPOSER_INPUT}
          placeholder={target ? '对 #7 说…' : '和总管说点什么…'}
        />
      </div>
      {!target && (
        <Button variant="outline" size="sm" className="self-start" onClick={() => setTarget(true)}>
          重新选 #7
        </Button>
      )}
    </div>
  );
}

export function ProductThreadReplySection() {
  return (
    <Section
      id="product-thread-reply"
      title="Talk to a thread (D65 draft)"
      lede="Draft for ian: reply to a needs-you thread from the home card, and talk to a thread from the Coordinator composer. Messages go straight to the thread; the Coordinator only gets a note."
    >
      <Specimen
        title="A. Reply behind a button"
        note="The card keeps its actions; 回复 opens the box under it"
        stage="canvas"
        className="flex-col"
      >
        {CARDS.map((card) => (
          <Labeled key={card.seq} label={`#${card.seq} · ${card.delivery}`}>
            <CardWithToggle card={card} />
          </Labeled>
        ))}
      </Specimen>
      <Specimen
        title="B. Reply box always open"
        note="Every needs-you card shows a one-line reply"
        stage="canvas"
        className="flex-col"
      >
        {CARDS.map((card) => (
          <Labeled key={card.seq} label={`#${card.seq} · ${card.delivery}`}>
            <CardWithReply card={card} />
          </Labeled>
        ))}
      </Specimen>
      <Specimen
        title="C. Composer target"
        note="ComposerTarget above or inside the Coordinator composer; × switches back to the Coordinator"
        stage="canvas"
        className="flex-col"
      >
        <Labeled label="C1 · above the composer">
          <Composer inside={false} />
        </Labeled>
        <Labeled label="C2 · inside the composer">
          <Composer inside />
        </Labeled>
      </Specimen>
    </Section>
  );
}
