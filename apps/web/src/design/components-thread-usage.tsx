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

export function ThreadUsageSection() {
  const [retryState, setRetryState] = useState<'ready' | 'error'>('error');
  return (
    <Section
      id="thread-usage"
      title="Thread usage"
      lede="The ring in the thread composer's tool row opens totals across every run. Unknown prices stay blank; models and machines remain readable in the popover."
    >
      <Specimen id="thread-usage-ring" title="Thread usage ring" stage="canvas">
        <div className="flex w-full max-w-105 justify-end">
          <ThreadUsageRing summary={SUMMARY} state="ready" onRetry={() => setRetryState('ready')} />
        </div>
      </Specimen>
      <Specimen id="expanded-thread-usage" title="Thread usage details" stage="canvas">
        <div className="w-full max-w-72">
          <ThreadUsageDetails
            summary={SUMMARY}
            state="ready"
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
