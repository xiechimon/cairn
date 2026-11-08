import { MODEL_ALIASES, MODEL_VENDORS } from './model-roster-data.js';

export function canonicalModelId(model: string): string {
  let id = model.trim().replace(/\s*\[[^\]]*\]$/u, '');
  const slash = id.lastIndexOf('/');
  if (slash !== -1) id = id.slice(slash + 1);
  id = id.toLowerCase();
  return MODEL_ALIASES[id] ?? id;
}

export function modelVendor(model: string): string | null {
  return MODEL_VENDORS[canonicalModelId(model)] ?? null;
}

export function modelsAreIndependent(authorModel: string, reviewerModel: string): boolean {
  const authorId = canonicalModelId(authorModel);
  const reviewerId = canonicalModelId(reviewerModel);
  if (authorId === reviewerId) return false;
  const authorVendor = MODEL_VENDORS[authorId] ?? null;
  const reviewerVendor = MODEL_VENDORS[reviewerId] ?? null;
  if (authorVendor === null || reviewerVendor === null) return false;
  return authorVendor !== reviewerVendor;
}

const CODE_REVIEW_VENDOR = 'OpenAI';

export function isCodexReviewModel(reviewerModel: string): boolean {
  return modelVendor(reviewerModel) === CODE_REVIEW_VENDOR;
}

export function codexReviewDetail(reviewerModel: string): string[] {
  const vendor = modelVendor(reviewerModel);
  if (vendor === null) return ['reviewer vendor unknown'];
  return vendor === CODE_REVIEW_VENDOR ? [] : [`reviewer vendor ${vendor} is not Codex`];
}
