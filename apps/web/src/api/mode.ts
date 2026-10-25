import { SCENARIO_PARAM } from '../fixtures/scenario.js';

const SCENARIOS_ENABLED = import.meta.env.DEV || import.meta.env.MODE === 'fixture';

export function isFixtureMode(search: URLSearchParams): boolean {
  return SCENARIOS_ENABLED && search.get(SCENARIO_PARAM) != null;
}
