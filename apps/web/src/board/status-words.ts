import type { ThreadReportContent } from '@cairn/shared';

export const STATUS_WORDS = {
  needsYou: '待你决定',
  running: '运行中',
  inReview: '审阅中',
  failed: '失败',
  doneUnverified: '已完成，未验证',
  verified: '已验证',
  idle: '空闲',
} as const;

export type StatusWord = (typeof STATUS_WORDS)[keyof typeof STATUS_WORDS];

export function doneStatusWord(verified: boolean | null | undefined): StatusWord {
  return verified === true ? STATUS_WORDS.verified : STATUS_WORDS.doneUnverified;
}

export function reportStatusWord(
  report: Pick<ThreadReportContent, 'phase' | 'verified'>,
): StatusWord {
  switch (report.phase) {
    case 'done':
      return doneStatusWord(report.verified);
    case 'failed':
      return STATUS_WORDS.failed;
    case 'review':
      return STATUS_WORDS.inReview;
  }
}
