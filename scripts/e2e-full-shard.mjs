#!/usr/bin/env node

import { listSpecs } from './e2e-affected-select.mjs';
import { runPlaywright, shardOf } from './e2e-shard-run.mjs';

const shard = process.argv.find((arg) => arg.startsWith('--shard='))?.slice('--shard='.length);
if (shard === undefined) {
  console.error('usage: node scripts/e2e-full-shard.mjs --shard=i/n');
  process.exit(2);
}

const all = listSpecs();
const run = shardOf(all, shard);
console.log(
  `[e2e] shard ${shard} runs ${run.length} of ${all.length} specs by recorded spec times`,
);
console.log(`  ${run.join(' ')}`);
await runPlaywright(run, { full: true, port: process.env.E2E_PORT ?? '8399' });
