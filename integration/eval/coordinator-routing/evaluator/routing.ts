type RoutingDecision = 'route' | 'ask' | 'answer';

interface RoutingRecord {
  decision: RoutingDecision;
  parts: { project: string }[];
  askCandidates: string[];
  blockedBy: [number, number][];
}

function evaluate(ctx: EvaluationContext): EvaluationResult {
  const expected = record(ctx.experiment?.itemExpectedOutput, 'expected output');
  const actual = record(ctx.observation.output, 'output');
  const scores: EvaluationScore[] = [
    score('routing.decision_ok', actual.decision === expected.decision, `${expected.decision} expected, ${actual.decision} observed`),
  ];

  if (expected.decision === 'route') {
    const wanted = expected.parts.map((part) => part.project).sort();
    const seen = actual.parts.map((part) => part.project).sort();
    scores.push(
      score('routing.projects_ok', same(wanted, seen), `${wanted.join(', ')} expected, ${seen.join(', ')} observed`),
      score('routing.split_ok', wanted.length === seen.length, `${wanted.length} parts expected, ${seen.length} observed`),
    );
  }

  if (expected.decision === 'ask') {
    const wanted = unique(expected.askCandidates);
    const seen = unique(actual.askCandidates);
    scores.push(
      score(
        'routing.ask_ok',
        actual.decision === 'ask' && same(wanted, seen),
        `${wanted.join(', ')} expected, ${seen.join(', ')} observed`,
      ),
    );
  }

  if (expected.decision === 'route' && expected.blockedBy.length > 0) {
    const wanted = expected.blockedBy.map(edge).sort();
    const seen = actual.blockedBy.map(edge).sort();
    scores.push(
      score('routing.blocked_by_ok', same(wanted, seen), `${wanted.join(', ')} expected, ${seen.join(', ')} observed`),
    );
  }

  return { scores };
}

function score(name: string, value: boolean, comment: string): EvaluationScore {
  return { name, value, dataType: 'BOOLEAN', comment };
}

function same(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function edge([from, to]: [number, number]): string {
  return `${from}>${to}`;
}

function record(raw: unknown, label: string): RoutingRecord {
  const value = raw as Partial<RoutingRecord> | null | undefined;
  if (
    typeof value !== 'object' ||
    value === null ||
    !['route', 'ask', 'answer'].includes(String(value.decision)) ||
    !Array.isArray(value.parts) ||
    !Array.isArray(value.askCandidates) ||
    !Array.isArray(value.blockedBy)
  )
    throw new Error(`The ${label} is missing or is not a routing record`);
  return value as RoutingRecord;
}
