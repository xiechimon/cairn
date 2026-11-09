#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brandFiles } from './logo.mjs';

const ROOT = join(import.meta.dirname, '../..');

for (const [path, content] of brandFiles()) {
  writeFileSync(join(ROOT, path), content);
  console.log(`wrote ${path}`);
}
