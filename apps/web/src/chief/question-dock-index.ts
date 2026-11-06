export function clampQuestionIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(index, 0), count - 1);
}

export function coordinatorBadgeCount(needsYouThreads: number, pendingQuestions: number): number {
  return needsYouThreads + pendingQuestions;
}
