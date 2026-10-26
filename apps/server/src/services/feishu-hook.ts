import type { SecretBox } from '@cairn/shared';
import type { Db } from '../db/client.js';

export interface FeishuReviewNotice {
  id: string;
  teamId: string;
  title: string;
  seqNum: number;
}

type ReviewListener = (deps: { db: Db; box?: SecretBox }, record: FeishuReviewNotice) => void;

let listener: ReviewListener | null = null;

export function setFeishuReviewListener(next: ReviewListener | null): void {
  listener = next;
}

export function notifyFeishuReview(
  deps: { db: Db; box?: SecretBox },
  record: FeishuReviewNotice,
  to: string,
): void {
  if (to !== 'review') return;
  listener?.(deps, record);
}
