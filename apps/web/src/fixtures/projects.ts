import { legacyDone, legacyReview, projectContent, r7 } from './core.js';
import type { FixtureSet } from './records.js';

export const projectFixture: FixtureSet = {
  todos: [legacyReview, legacyDone],
  now: r7(13, 14),
  project: projectContent,
};
