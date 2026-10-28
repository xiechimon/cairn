import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type FailureReplayBankCase,
  type FailureReplayCandidate,
  type FailureReplayEvent,
  failureReplayBankCaseSchema,
  failureReplayCandidateSchema,
  type TrajectoryPack,
  trajectoryPackSchema,
} from '@cairn/shared';

export class FailureReplayError extends Error {}

export type AssertionDrafter = (feedback: string, event: FailureReplayEvent) => string[];

export interface FailureReplayGenerateOptions {
  draftAssertions: AssertionDrafter;
  now: () => number;
}

interface DetectedEvent {
  event: FailureReplayEvent;
  feedback: string;
}

export function failureReplayCandidateId(buildId: string, event: FailureReplayEvent): string {
  const digest = createHash('sha256').update(`${buildId}\0${event}`).digest('hex').slice(0, 12);
  return `fr-${event}-${digest}`;
}

export function draftAssertionsFromFeedback(feedback: string): string[] {
  const trimmed = feedback.trim();
  if (trimmed === '') throw new FailureReplayError('feedback required to draft assertions');
  return [`must satisfy reviewer feedback: ${trimmed}`];
}

export function detectFailureReplayEvents(pack: TrajectoryPack): DetectedEvent[] {
  const out: DetectedEvent[] = [];
  const planRevision = pack.judgments.plan.find((row) => row.action === 'revision');
  if (planRevision !== undefined) {
    out.push({
      event: 'plan-rejection',
      feedback: planRevision.reason?.trim() || 'plan rejected without written reason',
    });
  }
  const reviewRevision = pack.judgments.diff.find((row) => row.action === 'revision');
  const reviewBlock = pack.judgments.gate_verdict.find(
    (row) => row.kind === 'review' && row.outcome === 'block',
  );
  if (reviewRevision !== undefined || reviewBlock !== undefined) {
    out.push({
      event: 'review-blocking',
      feedback:
        reviewRevision?.reason?.trim() ||
        reviewBlock?.perspective?.trim() ||
        'review blocked without written reason',
    });
  }
  if (pack.outcome?.revertedWithin7d === true) {
    out.push({
      event: 'post-merge-revert',
      feedback: 'reverted within 7 days',
    });
  }
  return out;
}

export function generateFailureReplayCandidates(
  packs: TrajectoryPack[],
  options: FailureReplayGenerateOptions,
): FailureReplayCandidate[] {
  const out: FailureReplayCandidate[] = [];
  const seen = new Set<string>();
  for (const pack of packs) {
    for (const detected of detectFailureReplayEvents(pack)) {
      const id = failureReplayCandidateId(pack.buildId, detected.event);
      if (seen.has(id)) continue;
      seen.add(id);
      const assertions = options.draftAssertions(detected.feedback, detected.event);
      if (assertions.length === 0)
        throw new FailureReplayError(`drafter returned no assertions for ${id}`);
      out.push(
        failureReplayCandidateSchema.parse({
          id,
          event: detected.event,
          buildId: pack.buildId,
          baseSha: pack.input.baseSha,
          prompt: { spec: pack.input.spec, baseSha: pack.input.baseSha },
          feedback: detected.feedback,
          draftAssertions: assertions,
          status: 'pending',
          createdAt: options.now(),
        }),
      );
    }
  }
  return out;
}

export function parseFailureReplayPacks(jsonl: string): TrajectoryPack[] {
  return jsonl
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => trajectoryPackSchema.parse(JSON.parse(line)));
}

export function parseFailureReplayCandidates(jsonl: string): FailureReplayCandidate[] {
  return jsonl
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => failureReplayCandidateSchema.parse(JSON.parse(line)));
}

export function confirmCandidatesByTraceIds(
  candidates: FailureReplayCandidate[],
  completedTraceIds: ReadonlySet<string>,
  traceIdOfBuild: (buildId: string) => string,
): FailureReplayCandidate[] {
  return candidates.map((candidate) =>
    completedTraceIds.has(traceIdOfBuild(candidate.buildId))
      ? failureReplayCandidateSchema.parse({ ...candidate, status: 'confirmed' })
      : candidate,
  );
}

export interface MaterializeOptions {
  now: () => number;
}

export function materializeConfirmedBankCases(
  candidates: FailureReplayCandidate[],
  bankDir: string,
  options: MaterializeOptions,
): FailureReplayBankCase[] {
  const written: FailureReplayBankCase[] = [];
  const casesDir = join(bankDir, 'cases');
  for (const candidate of candidates) {
    if (candidate.status !== 'confirmed') continue;
    const bankCase = failureReplayBankCaseSchema.parse({
      id: candidate.id,
      event: candidate.event,
      sourceBuildId: candidate.buildId,
      prompt: candidate.prompt,
      assertions: candidate.draftAssertions,
      confirmedAt: options.now(),
    });
    if (!existsSync(casesDir)) mkdirSync(casesDir, { recursive: true });
    const path = join(casesDir, `${bankCase.id}.json`);
    writeFileSync(path, `${JSON.stringify(bankCase, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    written.push(bankCase);
  }
  return written;
}
