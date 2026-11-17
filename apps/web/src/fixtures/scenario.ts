import type { FixtureSet } from './records.js';

export const SCENARIO_PARAM = 'scenario';
export const SCENARIOS_ENABLED = import.meta.env.DEV || import.meta.env.MODE === 'fixture';

const DEMO_ENABLED = import.meta.env.MODE === 'demo';

interface ScenarioData {
  scenarios: Record<string, FixtureSet>;
  fallback: FixtureSet;
  demo: FixtureSet;
}

const EMPTY_FIXTURE: FixtureSet = { todos: [], now: 0 };

let loaded: ScenarioData | null = null;
let loading: Promise<ScenarioData | null> | null = null;

export function loadScenarioFixtures(): Promise<ScenarioData | null> {
  if (!SCENARIOS_ENABLED && !DEMO_ENABLED) return Promise.resolve(null);
  if (loaded !== null) return Promise.resolve(loaded);
  loading ??= import('./scenario-data.js').then((module) => {
    loaded = module.SCENARIO_DATA;
    return loaded;
  });
  return loading;
}

export function resolveScenario(search: URLSearchParams): FixtureSet {
  if (loaded === null) return EMPTY_FIXTURE;
  if (DEMO_ENABLED) return loaded.demo;
  const id = search.get(SCENARIO_PARAM);
  return (id != null ? loaded.scenarios[id] : undefined) ?? loaded.fallback;
}
