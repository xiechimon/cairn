import { useState } from 'react';
import { ChiefDigestRow } from '../chief/chief-digest-row.js';
import { ChiefIdentity } from '../chief/chief-identity.js';
import { ChiefFallbackBanner, ChiefOutageBanner } from '../chief/chief-outage-banner.js';
import { ChiefQuestionCard } from '../chief/chief-question-card.js';
import { ProjectMenu } from '../chief/project-menu.js';
import { Button } from '../components/ui/button.js';
import { MessageScrollerProvider } from '../components/ui/message-scroller.js';
import { ChevronDown } from '../icons/index.js';
import {
  DIGEST_ITEMS,
  NOW,
  PROJECT,
  PROJECT_TITLE,
  QUESTION_ANSWERED,
  QUESTION_CANCELLED,
  QUESTION_PENDING,
} from './product-fixtures.js';
import { Cell, Labeled, Section, Specimen } from './specimen.js';

const PROJECTS = [
  { id: PROJECT, name: PROJECT_TITLE, description: 'The workbench itself' },
  { id: 'docs-site', name: 'docs-site', description: 'Public documentation' },
  { id: 'mobile', name: 'mobile' },
];

const CHIEF = { id: 'chief', displayName: 'Chief', avatarUrl: null };

export function ProductChiefSection() {
  const [last, setLast] = useState<string | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const [pickTarget, setPickTarget] = useState<string | null>(PROJECT);
  return (
    <Section
      id="product-chief"
      title="Coordinator"
      lede="The chief's parts: questions it asks you, the conversation digest, the home summary line, its identity, outage banners and the project picker."
    >
      <Specimen
        title="Question card"
        note={last ?? 'ChiefQuestionCard: answer with clicks or the number keys'}
        stage="canvas"
        className="flex-col"
      >
        <Labeled label="Pending, two steps, the second is multi-select">
          <div className="w-160">
            <ChiefQuestionCard
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
            <ChiefQuestionCard item={QUESTION_ANSWERED} />
          </div>
        </Labeled>
        <Labeled label="Cancelled">
          <div className="w-160">
            <ChiefQuestionCard item={QUESTION_CANCELLED} />
          </div>
        </Labeled>
      </Specimen>
      <Specimen
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
      <Specimen title="Identity" note="ChiefIdentity" stage="canvas">
        <Cell label="Identity, idle">
          <ChiefIdentity agent={CHIEF} />
        </Cell>
        <Cell label="Identity, busy">
          <ChiefIdentity agent={CHIEF} busy />
        </Cell>
        <Cell label="Identity, not linked">
          <ChiefIdentity agent={{ displayName: 'Chief', avatarUrl: null }} />
        </Cell>
      </Specimen>
      <Specimen
        title="Outage banners"
        note="ChiefOutageBanner, ChiefFallbackBanner"
        stage="canvas"
        className="flex-col"
      >
        <Labeled label="Quota used up, retry time known">
          <ChiefOutageBanner
            outage={{ reason: 'quota', model: 'claude-opus-5-5', retryAt: NOW + 45 * 60_000 }}
            onSettings={() => setLast('Open chief settings')}
          />
        </Labeled>
        <Labeled label="Overloaded, no retry time">
          <ChiefOutageBanner
            outage={{ reason: 'capacity', model: null, retryAt: null }}
            onSettings={() => setLast('Open chief settings')}
          />
        </Labeled>
        <Labeled label="Answered by the fallback model">
          <ChiefFallbackBanner
            model="claude-sonnet-5-5"
            onSettings={() => setLast('Change model')}
          />
        </Labeled>
      </Specimen>
      <Specimen
        title="Project menu"
        note="ProjectMenu with and without the automatic choice"
        stage="canvas"
      >
        <Cell label="With Auto">
          <ProjectMenu
            title="项目"
            projects={PROJECTS}
            value={project}
            withAuto
            onPick={setProject}
            trigger={<Button variant="outline" />}
          >
            {PROJECTS.find((p) => p.id === project)?.name ?? 'Auto'}
            <ChevronDown data-icon="inline-end" />
          </ProjectMenu>
        </Cell>
        <Cell label="Projects only, opens upward">
          <ProjectMenu
            title="项目"
            projects={PROJECTS}
            value={pickTarget}
            withAuto={false}
            side="top"
            onPick={setPickTarget}
            trigger={<Button variant="ghost" />}
          >
            {PROJECTS.find((p) => p.id === pickTarget)?.name ?? ''}
            <ChevronDown data-icon="inline-end" />
          </ProjectMenu>
        </Cell>
      </Specimen>
    </Section>
  );
}
