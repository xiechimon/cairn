import { useState } from 'react';
import { ChiefFallbackBanner, ChiefOutageBanner } from '../chief/chief-outage-banner.js';
import { QuestionReceipt } from '../chief/question-answered-line.js';
import { QuestionCard } from '../chief/question-card.js';
import { ChatChartBlock, ChatChartSkeleton } from '../components/chat/chat-chart.js';
import { DiffGlanceBlock, DiffGlanceSkeleton } from '../components/chat/diff-glance.js';
import {
  NOW,
  QUESTION_ANSWERED,
  QUESTION_CANCELLED,
  QUESTION_PENDING,
  REPLY_CHART,
  REPLY_GLANCE,
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
        id="question-card"
        title="Question card"
        note={
          last ??
          'QuestionCard: a card in the conversation where the Coordinator asked; numbered rows with descriptions, the first tagged recommended and never preselected, an Other input, Skip; answered or skipped, one receipt stays in its place'
        }
        stage="canvas"
        className="flex-col"
      >
        <Labeled label="Pending, two steps, the second is multi-select">
          <div className="w-160">
            <QuestionCard
              item={QUESTION_PENDING}
              onAnswer={({ answers }) =>
                setLast(
                  `Answered: ${answers.map((a) => a.choices?.join(' + ') ?? a.text).join(' / ')}`,
                )
              }
              onCancel={() => setLast('Question skipped')}
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
      </Specimen>
      <Specimen
        id="reply-blocks"
        title="Reply blocks"
        note="DiffGlanceBlock, ChatChartBlock: parts of a Coordinator reply at prose width, each with the skeleton of its final shape"
        stage="canvas"
        className="flex-col"
      >
        <Labeled label="Code change glance">
          <div className="w-160">
            <DiffGlanceBlock glance={REPLY_GLANCE} />
          </div>
        </Labeled>
        <Labeled label="Code change, still running">
          <div className="w-160">
            <DiffGlanceSkeleton path={null} />
          </div>
        </Labeled>
        <Labeled label="Before and after chart">
          <div className="w-144">
            <ChatChartBlock chart={REPLY_CHART} />
          </div>
        </Labeled>
        <Labeled label="Chart, still running">
          <div className="w-144">
            <ChatChartSkeleton />
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
