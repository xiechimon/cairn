import { useState } from 'react';
import { ThreadUsageDisclosure } from '../board/thread-usage-footer.js';
import type { ThreadUsageSummary } from '../board/thread-usage-model.js';
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
      lede="A quiet disclosure under the thread header meta opens into totals across every run. Unknown prices and unavailable duration stay blank; models and machines remain readable in the expanded view."
    >
      <Specimen id="collapsed-thread-usage" title="Collapsed thread usage" stage="canvas">
        <div className="w-full max-w-105">
          <ThreadUsageDisclosure
            summary={SUMMARY}
            state="ready"
            onRetry={() => setRetryState('ready')}
          />
        </div>
      </Specimen>
      <Specimen id="expanded-thread-usage" title="Expanded thread usage" stage="canvas">
        <div className="w-full max-w-105">
          <ThreadUsageDisclosure
            summary={SUMMARY}
            state="ready"
            onRetry={() => setRetryState('ready')}
            defaultOpen
          />
        </div>
      </Specimen>
      <Specimen id="unpriced-thread-usage" title="Unpriced thread usage" stage="canvas">
        <div className="w-full max-w-105">
          <ThreadUsageDisclosure
            summary={{ ...SUMMARY, cost: '—' }}
            state="ready"
            onRetry={() => setRetryState('ready')}
            defaultOpen
          />
        </div>
      </Specimen>
      <Specimen
        id="loading-and-failed-thread-usage"
        title="Loading and failed thread usage"
        stage="canvas"
      >
        <div className="flex w-full max-w-105 flex-col gap-4">
          <ThreadUsageDisclosure
            summary={{ ...SUMMARY, tokens: '—', cached: '—', models: [], machines: [] }}
            state="loading"
            onRetry={() => setRetryState('ready')}
          />
          <ThreadUsageDisclosure
            summary={SUMMARY}
            state={retryState}
            onRetry={() => setRetryState('ready')}
            defaultOpen
          />
        </div>
      </Specimen>
    </Section>
  );
}
