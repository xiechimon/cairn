#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { brandFiles } from './logo.mjs';

const ROOT = join(import.meta.dirname, '../..');

for (const [path, content] of brandFiles()) {
  mkdirSync(dirname(join(ROOT, path)), { recursive: true });
  writeFileSync(join(ROOT, path), content);
  console.log(`wrote ${path}`);
}
