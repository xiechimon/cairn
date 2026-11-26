import { useState } from 'react';
import type { ThreadUsageSummary } from '../board/thread-usage-model.js';
import { ThreadUsageDetails, ThreadUsageRing } from '../board/thread-usage-ring.js';
import { UsageBreakdownSection } from '../components/usage-breakdown.js';
import { Section, Specimen } from './specimen.js';

const SUMMARY: ThreadUsageSummary = {
  cost: '$1.42',
  tokens: '212k',
  cached: '91%',
  models: ['anthropic/claude-sonnet-5-5', 'openai/gpt-6.1-sol'],
  machines: ['omarchy', 'Mac'],
  duration: '',
  engines: [],
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
            summary={{ ...SUMMARY, cost: '' }}
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
            summary={{ ...SUMMARY, tokens: '', cached: '', models: [], machines: [] }}
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
      <Specimen id="usage-breakdown" title="Usage breakdown" stage="canvas">
        <div className="w-full max-w-72">
          <UsageBreakdownSection
            testId="specimen-usage-breakdown"
            statsTestId="specimen-usage-stats"
            data={{
              turns: 4,
              duration: '1m 34s',
              cost: '$0.30',
              tokens: '59.6k',
              cached: '88.6%',
              latestEngine: { label: 'Devin', runtime: 'devin' },
              historyEngines: [{ label: 'Claude Code', runtime: 'claude-code' }],
              latestModel: {
                raw: 'swe-2-1-medium',
                provider: 'devin',
                providerLabel: 'Devin',
                modelId: 'swe-2-1-medium',
                modelName: 'SWE-2.1',
                runtime: 'devin',
              },
              historyModels: [
                {
                  raw: 'anthropic-ultra/claude-opus-5-5',
                  provider: 'anthropic-ultra',
                  providerLabel: 'Anthropic Ultra',
                  modelId: 'claude-opus-5-5',
                  modelName: 'Claude Opus 5.5',
                  runtime: 'pi',
                },
              ],
              latestRunner: { id: 'm-mini', name: 'Ians-Mac-mini', osPlatform: 'darwin' },
              historyRunners: [{ id: 'm-mac', name: 'xmonsMac-3574.local', osPlatform: 'darwin' }],
            }}
          />
        </div>
      </Specimen>
    </Section>
  );
}
