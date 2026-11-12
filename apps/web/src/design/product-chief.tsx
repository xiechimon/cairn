import { useState } from 'react';
import { ChiefDigestRow } from '../chief/chief-digest-row.js';
import { ChiefIdentity } from '../chief/chief-identity.js';
import { ChiefFallbackBanner, ChiefOutageBanner } from '../chief/chief-outage-banner.js';
import { QuestionAnsweredLine, QuestionAsked } from '../chief/question-answered-line.js';
import { QuestionChips } from '../chief/question-chips.js';
import { answerLines } from '../chief/question-lifecycle.js';
import { UserMessageBubble } from '../components/chat/user-message-bubble.js';
import { MessageScrollerProvider } from '../components/ui/message-scroller.js';
import {
  DIGEST_ITEMS,
  NOW,
  QUESTION_ANSWERED,
  QUESTION_CANCELLED,
  QUESTION_PENDING,
} from './product-fixtures.js';
import { Cell, Labeled, Section, Specimen } from './specimen.js';

const CHIEF = { id: 'chief', displayName: 'Coordinator', avatarUrl: null };

export function ProductChiefSection() {
  const [last, setLast] = useState<string | null>(null);
  return (
    <Section
      id="product-chief"
      title="Coordinator"
      lede="The Coordinator's parts: questions it asks you, the conversation digest, the home summary line, its identity, and outage banners."
    >
      <Specimen
        id="question-chips"
        title="Question chips"
        note={
          last ??
          'QuestionChips: a chip answers, digits pick, the composer types a free answer; answered, the questions stay as reply bubbles above one owner bubble'
        }
        stage="canvas"
        className="flex-col"
      >
        <Labeled label="Pending, two steps, the second is multi-select">
          <div className="w-160">
            <QuestionChips
              item={QUESTION_PENDING}
              onAnswer={({ answers }) =>
                setLast(
                  `Answered: ${answers.map((a) => a.choices?.join(' + ') ?? a.text).join(' / ')}`,
                )
              }
              onCancel={() => setLast('Question cancelled')}
            />
          </div>
        </Labeled>
        <Labeled label="Answered">
          <div className="flex w-160 flex-col gap-6">
            <QuestionAsked item={QUESTION_ANSWERED} />
            <div className="flex justify-end">
              <UserMessageBubble className="w-fit max-w-full whitespace-pre-line">
                {answerLines(QUESTION_ANSWERED).join('\n')}
              </UserMessageBubble>
            </div>
          </div>
        </Labeled>
        <Labeled label="Cancelled">
          <div className="w-160">
            <QuestionAnsweredLine item={QUESTION_CANCELLED} />
          </div>
        </Labeled>
      </Specimen>
      <Specimen
        id="digest"
        title="Digest"
        note="ChiefDigestRow: expand to see the grouped summary"
        stage="canvas"
        className="flex-col"
      >
        <MessageScrollerProvider>
          <Labeled label="Daily digest">
            <div className="w-160">
              <ChiefDigestRow reason="daily" madeAt={NOW} items={DIGEST_ITEMS} />
            </div>
          </Labeled>
          <Labeled label="Threshold digest">
            <div className="w-160">
              <ChiefDigestRow reason="threshold" madeAt={NOW} items={DIGEST_ITEMS.slice(0, 2)} />
            </div>
          </Labeled>
        </MessageScrollerProvider>
      </Specimen>
      <Specimen id="identity" title="Identity" note="ChiefIdentity" stage="canvas">
        <Cell label="Identity, idle">
          <ChiefIdentity agent={CHIEF} />
        </Cell>
        <Cell label="Identity, busy">
          <ChiefIdentity agent={CHIEF} busy />
        </Cell>
        <Cell label="Identity, not linked">
          <ChiefIdentity agent={{ displayName: 'Coordinator', avatarUrl: null }} />
        </Cell>
      </Specimen>
      <Specimen
        id="outage-banners"
        title="Outage banners"
        note="ChiefOutageBanner, ChiefFallbackBanner"
        stage="canvas"
        className="flex-col"
      >
        <Labeled label="Quota used up, retry time known">
          <ChiefOutageBanner
            outage={{ reason: 'quota', model: 'claude-opus-5-5', retryAt: NOW + 45 * 60_000 }}
            onSettings={() => setLast('Open Coordinator settings')}
          />
        </Labeled>
        <Labeled label="Overloaded, no retry time">
          <ChiefOutageBanner
            outage={{ reason: 'capacity', model: null, retryAt: null }}
            onSettings={() => setLast('Open Coordinator settings')}
          />
        </Labeled>
        <Labeled label="Answered by the fallback model">
          <ChiefFallbackBanner
            model="claude-sonnet-5-5"
            onSettings={() => setLast('Change model')}
          />
        </Labeled>
      </Specimen>
    </Section>
  );
}
