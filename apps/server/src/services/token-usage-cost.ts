import type { ModelCostRates } from '@cairn/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, provider, todo, tokenUsage } from '../db/schema.js';

export interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface CostColumns {
  costInput: number;
  costOutput: number;
  costCacheRead: number;
  costCacheWrite: number;
  costTotal: number;
}

export function costFromRates(tokens: TokenCounts, rates: ModelCostRates): CostColumns {
  const costInput = (tokens.input * rates.input) / 1_000_000;
  const costOutput = (tokens.output * rates.output) / 1_000_000;
  const costCacheRead = (tokens.cacheRead * rates.cacheRead) / 1_000_000;
  const costCacheWrite = (tokens.cacheWrite * rates.cacheWrite) / 1_000_000;
  return {
    costInput,
    costOutput,
    costCacheRead,
    costCacheWrite,
    costTotal: costInput + costOutput + costCacheRead + costCacheWrite,
  };
}

export function ratesForModel(
  db: Db,
  teamId: string | null,
  modelKey: string,
): ModelCostRates | undefined {
  if (teamId === null) return undefined;
  const slash = modelKey.indexOf('/');
  if (slash <= 0) return undefined;
  const row = db
    .select({ models: provider.models })
    .from(provider)
    .where(and(eq(provider.teamId, teamId), eq(provider.providerId, modelKey.slice(0, slash))))
    .get();
  return row?.models.find((model) => model.id === modelKey.slice(slash + 1))?.cost;
}

export function backfillTokenUsageCost(db: Db): void {
  const rows = db
    .select({
      buildId: tokenUsage.buildId,
      model: tokenUsage.model,
      input: tokenUsage.input,
      output: tokenUsage.output,
      cacheRead: tokenUsage.cacheRead,
      cacheWrite: tokenUsage.cacheWrite,
      teamId: todo.teamId,
    })
    .from(tokenUsage)
    .innerJoin(build, eq(build.id, tokenUsage.buildId))
    .innerJoin(todo, eq(todo.id, build.todoId))
    .where(
      and(
        isNull(tokenUsage.costInput),
        isNull(tokenUsage.costOutput),
        isNull(tokenUsage.costCacheRead),
        isNull(tokenUsage.costCacheWrite),
        isNull(tokenUsage.costTotal),
      ),
    )
    .all();
  for (const row of rows) {
    const rates = ratesForModel(db, row.teamId, row.model);
    if (rates === undefined) continue;
    db.update(tokenUsage)
      .set(costFromRates(row, rates))
      .where(and(eq(tokenUsage.buildId, row.buildId), eq(tokenUsage.model, row.model)))
      .run();
  }
}
