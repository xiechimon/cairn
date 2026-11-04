import { readFileSync } from 'node:fs';
import { createKeyfileSecretBox } from '../../apps/server/src/lib/secret-box.js';

console.error('decrypt helper started');

try {
  const key = process.argv[2];
  readFileSync(key);
  createKeyfileSecretBox(key).open(readFileSync(0, 'utf8'));
  console.log('decrypt ok');
} catch {
  console.error('decrypt failed');
  process.exitCode = 1;
}
