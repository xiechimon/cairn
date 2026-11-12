import { useState } from 'react';
import type { ThreadUsageSummary } from '../board/thread-usage-model.js';
import { ThreadUsageDetails, ThreadUsageRing } from '../board/thread-usage-ring.js';
import { Section, Specimen } from './specimen.js';

const SUMMARY: ThreadUsageSummary = {
  cost: '$1.42',
  tokens: '212k',
  cached: '91%',
  models: ['anthropic/claude-sonnet-5-5', 'openai/gpt-6.1-sol'],
  machines: ['omarchy', 'Mac'],
};

const CONTEXT = { tokens: 62_000, contextWindow: 200_000 };

export function ThreadUsageSection() {
  const [retryState, setRetryState] = useState<'ready' | 'error'>('error');
  return (
    <Section
      id="thread-usage"
      title="Thread usage"
      lede="The ring in the thread composer's tool row is the context ring of the main composer: its label and arc are the share of the context window in use. It opens the totals across every run. Without a context reading it is the bare ring with no number."
    >
      <Specimen id="thread-usage-ring" title="Thread usage ring" stage="canvas">
        <div className="flex w-full max-w-105 justify-end gap-6">
          <ThreadUsageRing
            summary={SUMMARY}
            state="ready"
            context={CONTEXT}
            onRetry={() => setRetryState('ready')}
          />
          <ThreadUsageRing summary={SUMMARY} state="ready" onRetry={() => setRetryState('ready')} />
        </div>
      </Specimen>
      <Specimen id="expanded-thread-usage" title="Thread usage details" stage="canvas">
        <div className="w-full max-w-72">
          <ThreadUsageDetails
            summary={SUMMARY}
            state="ready"
            context={CONTEXT}
            onRetry={() => setRetryState('ready')}
          />
        </div>
      </Specimen>
      <Specimen id="unpriced-thread-usage" title="Unpriced thread usage" stage="canvas">
        <div className="w-full max-w-72">
          <ThreadUsageDetails
            summary={{ ...SUMMARY, cost: '—' }}
            state="ready"
            onRetry={() => setRetryState('ready')}
          />
        </div>
      </Specimen>
      <Specimen
        id="loading-and-failed-thread-usage"
        title="Loading and failed thread usage"
        stage="canvas"
      >
        <div className="flex w-full max-w-72 flex-col gap-6">
          <ThreadUsageDetails
            summary={{ ...SUMMARY, tokens: '—', cached: '—', models: [], machines: [] }}
            state="loading"
            onRetry={() => setRetryState('ready')}
          />
          <ThreadUsageDetails
            summary={SUMMARY}
            state={retryState}
            onRetry={() => setRetryState('ready')}
          />
        </div>
      </Specimen>
    </Section>
  );
}
