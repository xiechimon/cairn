import type { ScheduleItem, ScheduleReport } from '@cairn/shared';

export function isActionable(item: ScheduleItem): boolean {
  return item.labelChange !== null || item.group === 'close';
}

export function canExecute(report: ScheduleReport, selected: ReadonlySet<number>): boolean {
  if (report.appliedAt !== null) return false;
  return scheduleSelection(report, selected).length > 0;
}

export function scheduleSelection(report: ScheduleReport, selected: ReadonlySet<number>): number[] {
  return report.items
    .filter((item) => selected.has(item.issue) && isActionable(item))
    .map((item) => item.issue);
}

export function unparsedDepTexts(deps: ScheduleReport['unparsedDeps']): string[] {
  return deps.map((dep) => `#${dep.issue} ${dep.text}`.trim());
}
