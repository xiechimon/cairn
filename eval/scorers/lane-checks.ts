import type { CheckResult, LaneTask, TurnRecord } from '../harness/types.js';

const ok = (name: string, gate: boolean): CheckResult => ({ name, value: 1, gate });
const fail = (name: string, comment: string, gate: boolean): CheckResult => ({
  name,
  value: 0,
  comment,
  gate,
});

export function scoreLane(task: LaneTask, record: TurnRecord): CheckResult[] {
  const gate = task.gate;
  if (record.incomplete !== undefined || record.lane === undefined)
    return [{ name: 'incomplete', value: 0, comment: record.incomplete ?? 'no lane record', gate }];
  const lane = record.lane;
  const results: CheckResult[] = [
    lane.exitCode === 0
      ? ok('lane.completed', gate)
      : fail('lane.completed', `exit=${lane.exitCode}`, gate),
  ];
  const badFiles = lane.fileChecks.filter((check) => !check.ok);
  results.push(
    badFiles.length === 0
      ? ok('lane.files_ok', gate)
      : fail('lane.files_ok', badFiles.map((check) => check.path).join(', '), gate),
  );
  const badCmds = lane.commandChecks.filter((check) => !check.ok);
  results.push(
    badCmds.length === 0
      ? ok('lane.tests_pass', gate)
      : fail('lane.tests_pass', badCmds.map((check) => check.command).join(', '), gate),
  );
  if (task.checks.allowPaths !== undefined) {
    const toRegExp = (glob: string) =>
      new RegExp(
        `^${glob
          .split('**')
          .map((part) =>
            part
              .split('*')
              .map((seg) => seg.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
              .join('[^/]*'),
          )
          .join('.*')}$`,
      );
    const allowed = task.checks.allowPaths.map(toRegExp);
    const outside = lane.changedFiles.filter((file) => !allowed.some((re) => re.test(file)));
    results.push(
      outside.length === 0
        ? ok('lane.diff_ok', gate)
        : fail('lane.diff_ok', `out of bounds: ${outside.join(', ')}`, gate),
    );
  }
  return results;
}
