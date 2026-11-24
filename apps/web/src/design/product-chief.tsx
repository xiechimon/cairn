import { useState } from 'react';
import { ChiefFallbackBanner, ChiefOutageBanner } from '../chief/chief-outage-banner.js';
import { QuestionReceipt } from '../chief/question-answered-line.js';
import { QuestionCard } from '../chief/question-card.js';
import { useI18n } from '../i18n/provider.js';
import {
  NOW,
  QUESTION_ANSWERED,
  QUESTION_CANCELLED,
  QUESTION_PARKED,
  QUESTION_PENDING,
  QUESTION_WITHDRAWN,
} from './product-fixtures.js';
import { Labeled, Section, Specimen } from './specimen.js';

export function ProductChiefSection() {
  const { t } = useI18n();
  const [last, setLast] = useState<string | null>(null);
  return (
    <Section
      id="product-chief"
      title="Coordinator"
      lede="The Coordinator's parts: questions it asks you, the home summary line, and outage banners."
    >
      <Specimen
        id="question-card"
        title="Question card"
        note={
          last ??
          'QuestionCard: docked above the composer; a row click answers a single choice, checkboxes and the arrow answer a multi choice, digits only move focus; answered or skipped, a receipt stays in the transcript'
        }
        stage="canvas"
        className="flex-col"
      >
        <Labeled label="Pending, two steps, the second is multi-select">
          <div className="flex max-h-120 w-160 flex-col rounded-(--radius-composer) bg-(--composer-fill) shadow-(--shadow-composer)">
            <QuestionCard
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
          <div className="w-160">
            <QuestionReceipt item={QUESTION_ANSWERED} />
          </div>
        </Labeled>
        <Labeled label="Skipped">
          <div className="w-160">
            <QuestionReceipt item={QUESTION_CANCELLED} />
          </div>
        </Labeled>
        <Labeled label="Parked — still answerable, Coordinator continued">
          <div className="w-160">
            <div className="flex max-w-full min-w-0 flex-col items-start gap-1.5">
              <div className="w-full max-w-full rounded-(--radius-reply) bg-(--reply-bubble-fill) px-3.5">
                <QuestionCard item={QUESTION_PARKED} multiline />
              </div>
              <p className="m-0 pl-1.5 text-meta text-content-tertiary">
                {t('Coordinator 没有等回答，已继续')}
              </p>
            </div>
          </div>
        </Labeled>
        <Labeled label="Withdrawn — receipt carries the reason">
          <div className="w-160">
            <QuestionReceipt item={QUESTION_WITHDRAWN} />
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
