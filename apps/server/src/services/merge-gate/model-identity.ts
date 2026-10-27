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

export function independenceVendorDetail(authorModel: string, reviewerModel: string): string[] {
  if (modelsAreIndependent(authorModel, reviewerModel)) return [];
  const authorVendor = modelVendor(authorModel);
  const reviewerVendor = modelVendor(reviewerModel);
  const detail: string[] = [];
  if (authorVendor !== null && authorVendor === reviewerVendor) {
    detail.push(`reviewer shares author vendor ${authorVendor}`);
  }
  if (authorVendor === null) detail.push('author vendor unknown');
  if (reviewerVendor === null) detail.push('reviewer vendor unknown');
  if (authorVendor !== null && reviewerVendor === null) {
    detail.push(`author vendor ${authorVendor}`);
  }
  return detail;
}
