import { readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { BaseSequencer } from 'vitest/node';
import { partitionByWeight } from './timed-partition.mjs';

export { partitionByWeight };

export function shardKey(projectName, projectRoot, moduleId) {
  return `${projectName}:${relative(projectRoot, moduleId).split(sep).join('/')}`;
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
