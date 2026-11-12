import { EngineCard } from '../board/engine-card.js';
import type { EngineRun, EngineRunActions } from '../board/engine-run.js';
import { ENGINE_SCRIPTS, engineRunAt } from '../fixtures/engine-runs.js';
import { ProductProviders } from './product-providers.js';
import { Section, Specimen } from './specimen.js';

const ACTIONS: EngineRunActions = {
  answer: () => undefined,
  takeOver: () => undefined,
  handBack: () => undefined,
};

const { running, failed } = ENGINE_SCRIPTS;

function Card({ run }: { run: EngineRun }) {
  return (
    <ProductProviders>
      <div className="w-full max-w-97">
        <EngineCard run={run} actions={ACTIONS} className="mt-0" />
      </div>
    </ProductProviders>
  );
}

export function EngineCardSection() {
  return (
    <Section
      id="engine-card"
      title="Engine card"
      lede="A run a task thread dispatched to an engine, as one card in the thread conversation at the panel's 388px column. One ring; the checklist, trace rows, diff and chips inside are the conversation's own parts. Fixture data only: no live response carries a run yet."
    >
      <Specimen id="engine-card-running" title="Running" stage="canvas">
        <Card run={engineRunAt(running, 4)} />
      </Specimen>
      <Specimen id="engine-card-waiting" title="Waiting for input" stage="canvas">
        <Card run={engineRunAt(running, 6)} />
      </Specimen>
      <Specimen id="engine-card-finished" title="Finished" stage="canvas">
        <Card run={engineRunAt(running, 8)} />
      </Specimen>
      <Specimen id="engine-card-failed" title="Failed" stage="canvas">
        <Card run={engineRunAt(failed, 6)} />
      </Specimen>
      <Specimen id="engine-card-taken-over" title="Taken over" stage="canvas">
        <Card run={engineRunAt(running, 6, {}, true)} />
      </Specimen>
    </Section>
  );
}
