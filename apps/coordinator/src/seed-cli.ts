import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { readThreadRows, seedCoordinatorStore } from './runtime/seed.js';

const { values } = parseArgs({
  options: {
    db: { type: 'string' },
    thread: { type: 'string' },
    summary: { type: 'string' },
    store: { type: 'string' },
    provider: { type: 'string', default: 'anthropic' },
    model: { type: 'string', default: 'claude-haiku-5-5' },
  },
});
if (!values.db || !values.thread || !values.summary || !values.store) {
  console.error(
    'usage: seed-cli --db <read-only server.db backup> --thread <chief thread id> --summary <fold state.json> --store <coordinator.sqlite>',
  );
  process.exit(2);
}
const state = JSON.parse(readFileSync(values.summary, 'utf8')) as { summary: string; at: number };
const rows = readThreadRows(values.db, values.thread, state.at);
const { messages } = await seedCoordinatorStore(values.store, state.summary, rows, {
  provider: values.provider,
  modelId: values.model,
});
console.log(
  `seeded ${values.store}: summary ${state.summary.length} chars, ${rows.length} rows after ${new Date(state.at).toISOString()} -> ${messages} messages`,
);
