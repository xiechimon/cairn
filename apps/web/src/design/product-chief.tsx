import { useState } from 'react';
import { ChiefFallbackBanner, ChiefOutageBanner } from '../chief/chief-outage-banner.js';
import { QuestionAnsweredLine, QuestionAsked } from '../chief/question-answered-line.js';
import { QuestionChips } from '../chief/question-chips.js';
import { answerLines } from '../chief/question-lifecycle.js';
import { UserMessageBubble } from '../components/chat/user-message-bubble.js';
import {
  NOW,
  QUESTION_ANSWERED,
  QUESTION_CANCELLED,
  QUESTION_PENDING,
} from './product-fixtures.js';
import { Labeled, Section, Specimen } from './specimen.js';

export function ProductChiefSection() {
  const [last, setLast] = useState<string | null>(null);
  return (
    <Section
      id="product-chief"
      title="Coordinator"
      lede="The Coordinator's parts: questions it asks you, the home summary line, and outage banners."
    >
      <Specimen
        id="question-chips"
        title="Question chips"
        note={
          last ??
          'QuestionChips: a chip answers, digits pick, the composer types a free answer; answered, the questions stay as Coordinator replies above one owner bubble'
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
