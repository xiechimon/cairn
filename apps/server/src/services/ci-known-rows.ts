import { type BuildDeps, hasMessageRow } from './builds.js';
import { writeSystemRow } from './ci-loop-rows.js';

export class KnownRows {
  private readonly memo = new Set<string>();

  constructor(private readonly deps: BuildDeps) {}

  has(buildId: string, content: string, since: number): boolean {
    const key = `${buildId}\u0000${since}\u0000${content}`;
    if (this.memo.has(key)) return true;
    if (!hasMessageRow(this.deps, buildId, 'system', content, since)) return false;
    this.memo.add(key);
    return true;
  }

  hint(buildId: string, content: string, since: number): void {
    if (this.has(buildId, content, since)) return;
    writeSystemRow(this.deps, buildId, content);
  }

  retain(buildIds: ReadonlySet<string>): void {
    for (const key of this.memo)
      if (!buildIds.has(key.slice(0, key.indexOf('\u0000')))) this.memo.delete(key);
  }
}
