import type { CheckResult, JourneyTask, TurnRecord } from '../harness/types.js';

const ok = (name: string, gate: boolean): CheckResult => ({ name, value: 1, gate });
const fail = (name: string, comment: string, gate: boolean): CheckResult => ({
  name,
  value: 0,
  comment,
  gate,
});

/** A journey case passes only when the patch, the tests and the delivery chain all agree. */
export function scoreJourney(task: JourneyTask, record: TurnRecord): CheckResult[] {
  const gate = task.gate;
  if (record.incomplete !== undefined || record.journey === undefined)
    return [
      { name: 'incomplete', value: 0, comment: record.incomplete ?? 'no journey record', gate },
    ];
  const journey = record.journey;
  const results: CheckResult[] = [
    journey.routed
      ? ok('journey.routed', gate)
      : fail('journey.routed', 'coordinator placed no todo for the expected project', gate),
    journey.claimed
      ? ok('journey.claimed', gate)
      : fail('journey.claimed', 'no machine claimed the step', gate),
    journey.delivered
      ? ok('journey.delivered', gate)
      : fail('journey.delivered', 'no assistant message on a finished step', gate),
    journey.acceptanceBlocked
      ? fail('journey.no_interruption', 'delivery raised an acceptance block', gate)
      : ok('journey.no_interruption', gate),
  ];
  const badFiles = journey.fileChecks.filter((check) => !check.ok);
  results.push(
    badFiles.length === 0
      ? ok('journey.files_ok', gate)
      : fail('journey.files_ok', badFiles.map((check) => check.path).join(', '), gate),
  );
  const badCommands = journey.commandChecks.filter((check) => !check.ok);
  results.push(
    journey.commandChecks.length === 0
      ? fail('journey.tests_pass', 'no trusted test ran', gate)
      : badCommands.length === 0
        ? ok('journey.tests_pass', gate)
        : fail('journey.tests_pass', badCommands.map((check) => check.command).join(', '), gate),
  );
  return results;
}

export function journeyPassed(task: JourneyTask, record: TurnRecord): boolean {
  return scoreJourney(task, record).every((check) => check.value === 1);
}
