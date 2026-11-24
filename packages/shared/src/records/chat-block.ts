import { z } from 'zod';
import { chatChartSchema } from './chat-chart.js';
import { diffGlanceSchema } from './diff-glance.js';

export const SHOW_DIFF_TOOL = 'show_diff';
export const SHOW_CHART_TOOL = 'show_chart';

export const chatBlockSchema = z.discriminatedUnion('block', [
  z.object({ block: z.literal('diff'), glance: diffGlanceSchema, fallbackMarkdown: z.string() }),
  z.object({ block: z.literal('chart'), chart: chatChartSchema, fallbackMarkdown: z.string() }),
]);
export type ChatBlockResult = z.infer<typeof chatBlockSchema>;
