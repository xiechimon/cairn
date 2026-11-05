import { writeFileSync } from 'node:fs';
import { CHIEF_REMOTE_TOOLS } from '../../../packages/shared/src/protocol/chief-tools.js';

const output = process.argv[2];
if (!output) throw new Error('Usage: tsx export-registry.mts <output.json>');
writeFileSync(
  output,
  `${JSON.stringify(Object.fromEntries(CHIEF_REMOTE_TOOLS.map((tool) => [tool.name, { ...(tool.parameters as Record<string, unknown>), description: tool.description }])), null, 2)}\n`,
);
