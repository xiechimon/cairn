import type { TopModel } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chiefMessage } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { taskModelCandidates } from './providers.js';
import { appendTopModel, favoriteModelOf, readTopModels } from './top-models.js';

export interface CatalogModel {
  provider: string;
  providerLabel: string;
  modelId: string;
  modelName: string;
}

export interface ModelRef {
  provider: string;
  modelId: string;
}

const NEGATION =
  /不要|不用|不必|不需要|别用|别再|别把|不是|并没有|没有说|除非|如果|假如|假设|万一|\bnot\b|\bnever\b|\bdon't\b|\bdo not\b|\binstead\b|\bunless\b|\bif\b|\bsuppose\b|what if/i;
const SWITCH = /换成|改成|改为|\bswitch to\b|\bchange to\b/i;

function qualified(row: CatalogModel): string {
  return `${row.provider}/${row.modelId}`;
}

function label(row: CatalogModel): string {
  return row.modelName === row.modelId ? row.modelId : `${row.modelName}（${row.providerLabel}）`;
}

export function catalogModel(ref: ModelRef, teamId: string, db: Db): CatalogModel {
  const rows = taskModelCandidates({ db }, teamId);
  const found = rows.find((row) => row.provider === ref.provider && row.modelId === ref.modelId);
  if (found === undefined) {
    throw new HttpError(
      400,
      `model ${ref.provider}/${ref.modelId} is not enabled here, so it cannot be added to 常用模型. Check models, or ask the owner to enable that provider first.`,
    );
  }
  return found;
}

export function resolveCatalogModel(
  db: Db,
  teamId: string,
  query: { model: string; provider?: string | undefined },
): CatalogModel {
  const rows = taskModelCandidates({ db }, teamId);
  const exact = rows.filter((row) => qualified(row) === query.model);
  if (exact.length === 1) return exact[0] as CatalogModel;
  const scoped =
    query.provider === undefined ? rows : rows.filter((row) => row.provider === query.provider);
  const byId = scoped.filter((row) => row.modelId === query.model);
  const lowered = query.model.toLowerCase();
  const byName = scoped.filter((row) => row.modelName.toLowerCase() === lowered);
  const picked = byId.length === 0 ? byName : byId;
  const only = picked.length === 1 ? picked[0] : undefined;
  if (only !== undefined) return only;
  if (picked.length > 1) {
    const options = picked.map((row) => `${qualified(row)}（${row.providerLabel}）`).join('、');
    throw new HttpError(
      400,
      `model ${query.model} matches ${picked.length} models: ${options}. Pass provider with model, or use provider/modelId.`,
    );
  }
  const providerless =
    query.provider === undefined ? rows.filter((row) => row.modelId === query.model) : [];
  if (providerless.length > 1) {
    throw new HttpError(
      400,
      `model ${query.model} matches several providers: ${providerless.map(qualified).join('、')}. Pass provider with model, or use provider/modelId.`,
    );
  }
  throw new HttpError(
    400,
    `model ${query.model} is not an enabled model here. Read models for the exact provider/modelId, or ask the owner to enable that provider first.`,
  );
}

export function addFavoriteModel(
  db: Pick<Db, 'select' | 'insert'>,
  teamId: string,
  row: CatalogModel,
): { added: boolean; model: TopModel; label: string; count: number } {
  const appended = appendTopModel(db, teamId, {
    provider: row.provider,
    modelId: row.modelId,
    thinkingLevel: null,
  });
  return {
    added: appended.added,
    model: { provider: row.provider, modelId: row.modelId, thinkingLevel: null },
    label: label(row),
    count: appended.models.length,
  };
}

export function isFavorite(db: Db, teamId: string, ref: ModelRef): boolean {
  return favoriteModelOf(readTopModels(db, teamId).models, ref) !== undefined;
}

const MAX_QUOTE_CHARS = 500;

function normalize(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

function containsNeedle(text: string, needle: string): boolean {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(needle)) {
    return text.toLowerCase().includes(needle.toLowerCase());
  }
  const escaped = needle.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
}

function namesModel(text: string, needles: readonly string[]): boolean {
  const haystack = normalize(text);
  return needles.some((needle) => needle !== '' && containsNeedle(haystack, needle));
}

const ASK =
  /用|跑|执行|调用|试试|选|派|换成|改成|改为|使用|帮我|给我|安排|\buse\b|\brun\b|\bpick\b|\bchoose\b|\btry\b|\bswitch to\b|\bchange to\b|\bcontinue with\b/i;

function clauseAllows(clause: string, quote: string): boolean {
  const at = clause.indexOf(quote);
  if (at < 0) return false;
  const before = clause.slice(0, at);
  const after = clause.slice(at + quote.length);
  if (NEGATION.test(before) || NEGATION.test(after)) return false;
  return !SWITCH.test(after);
}

function affirmativelyNames(message: string, quote: string, needles: readonly string[]): boolean {
  if (!namesModel(quote, needles)) return false;
  const clauses = normalize(message)
    .split(/[。！？!?\n；;，,]/)
    .map((clause) => clause.trim())
    .filter((clause) => clause !== '')
    .filter((clause) => clause.includes(quote))
    .filter((clause) => namesModel(clause, needles));
  return (
    clauses.length > 0 &&
    clauses.every((clause) => clauseAllows(clause, quote)) &&
    clauses.some((clause) => ASK.test(clause))
  );
}

export function assertOwnerNamedModel(
  db: Pick<Db, 'select'>,
  input: {
    threadId: string;
    turnMessageIds: readonly string[];
    messageId: string;
    quote: string;
    row: CatalogModel;
  },
): void {
  if (!input.turnMessageIds.includes(input.messageId)) {
    throw new HttpError(
      403,
      `message ${input.messageId} did not start this turn, so it cannot authorize adding a model. Cite an owner message of this turn, or ask the owner with the card.`,
    );
  }
  const message = db
    .select({
      role: chiefMessage.role,
      origin: chiefMessage.origin,
      content: chiefMessage.content,
      ownerComposedAt: chiefMessage.ownerComposedAt,
    })
    .from(chiefMessage)
    .where(and(eq(chiefMessage.id, input.messageId), eq(chiefMessage.threadId, input.threadId)))
    .get();
  if (
    message === undefined ||
    message.role !== 'user' ||
    typeof message.content !== 'string' ||
    message.origin === 'synthetic' ||
    message.origin === 'task-prompt'
  ) {
    throw new HttpError(403, `message ${input.messageId} is not the owner's own chat text`);
  }
  if (message.ownerComposedAt == null) {
    throw new HttpError(
      403,
      `message ${input.messageId} was not typed by the owner in their own Cairn window, so it cannot add a model. Ask the owner to say it there, or use the approval card.`,
    );
  }
  const quote = normalize(input.quote).slice(0, MAX_QUOTE_CHARS);
  if (quote === '') throw new HttpError(400, 'quote is empty: copy the words that name this model');
  const content = normalize(message.content);
  if (!content.includes(quote)) {
    throw new HttpError(400, `quote is not an exact part of message ${input.messageId}`);
  }
  const needles = [input.row.modelName, input.row.modelId, qualified(input.row)];
  if (!affirmativelyNames(content, quote, needles)) {
    throw new HttpError(
      400,
      `the quoted words do not plainly ask to add ${input.row.modelName}: mention, negation, hypothetical or pasted text is not permission. Ask the owner with the approval card instead.`,
    );
  }
}
