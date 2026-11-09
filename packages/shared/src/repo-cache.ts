import { createHash } from 'node:crypto';
import { normalizedRepoRef } from './repo-ref.js';

export function repositoryCacheRefPrefix(url: string): string {
  const normalized = normalizedRepoRef(url);
  const identity = /^github\.com\//i.test(normalized) ? normalized.toLowerCase() : normalized;
  return `refs/cairn/repositories/${createHash('sha256').update(identity).digest('hex')}`;
}
