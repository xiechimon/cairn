import { z } from 'zod';
import { BRIEF_MARKER_BEGIN, BRIEF_MARKER_END } from '../brief-markers.js';

export const PROJECT_INSTRUCTIONS_MAX = 16_000;

export const workerBriefTextSchema = z
  .string()
  .max(PROJECT_INSTRUCTIONS_MAX)
  .refine(
    (text) => !text.includes(BRIEF_MARKER_BEGIN) && !text.includes(BRIEF_MARKER_END),
    'Must not contain the Cairn runtime markers',
  );
