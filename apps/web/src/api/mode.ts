import { SCENARIO_PARAM, SCENARIOS_ENABLED } from '../fixtures/scenario.js';

const DEMO_ENABLED = import.meta.env.MODE === 'demo';

export function isFixtureMode(search: URLSearchParams): boolean {
  if (DEMO_ENABLED) return true;
  return SCENARIOS_ENABLED && search.get(SCENARIO_PARAM) != null;
}
