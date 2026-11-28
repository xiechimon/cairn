import { and, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { externalEffect } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import type { EffectKindRegistry } from './external-effects.js';

const RETIRED_GITHUB_ISSUE_KINDS = ['github-issue-create', 'github-issue-title'] as const;

export function retireGithubIssueEffects(db: Db, registry: EffectKindRegistry): void {
  for (const kind of RETIRED_GITHUB_ISSUE_KINDS) {
    registry.set(kind, { policy: 'replay-safe', send: async () => null });
  }
  db.update(externalEffect)
    .set({
      state: 'delivered',
      receipt: { retired: 'github-issue-bridge' },
      updatedAt: nowMs(),
    })
    .where(
      and(
        inArray(externalEffect.kind, [...RETIRED_GITHUB_ISSUE_KINDS]),
        inArray(externalEffect.state, ['pending', 'sending', 'interrupted']),
      ),
    )
    .run();
}
