import { readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { BaseSequencer } from 'vitest/node';

export function shardKey(projectName, projectRoot, moduleId) {
  return `${projectName}:${relative(projectRoot, moduleId).split(sep).join('/')}`;
}

export function partitionByWeight(keys, weights, count) {
  const known = keys
    .map((key) => weights[key])
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const fallback = Math.max(1, known[Math.floor(known.length / 2)] ?? 1);
  const items = keys
    .map((key) => ({ key, weight: Math.max(1, weights[key] ?? fallback) }))
    .sort((a, b) => b.weight - a.weight || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const bins = Array.from({ length: count }, () => ({ total: 0, keys: [] }));
  for (const item of items) {
    const lightest = bins.reduce((min, bin) => (bin.total < min.total ? bin : min));
    lightest.keys.push(item.key);
    lightest.total += item.weight;
  }
  return bins.map((bin) => bin.keys);
}

export class TimedShardSequencer extends BaseSequencer {
  async shard(files) {
    const { index, count } = this.ctx.config.shard;
    const weights = JSON.parse(
      readFileSync(new URL('./vitest-shard-weights.json', import.meta.url), 'utf8'),
    );
    const keyed = files.map((spec) => ({
      spec,
      key: shardKey(spec.project.name, spec.project.config.root, spec.moduleId),
    }));
    const chosen = new Set(
      partitionByWeight(
        keyed.map(({ key }) => key),
        weights,
        count,
      )[index - 1],
    );
    return keyed.filter(({ key }) => chosen.has(key)).map(({ spec }) => spec);
  }
}
