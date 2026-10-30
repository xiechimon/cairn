export interface RevisionExpect {
  kind: 'revision';
  defect: string[];
  drop: string[];
  keep: string[];
  minPlanChars: number;
}

export interface RevisionCase {
  id: string;
  tags: string[];
  prompt: string;
  priorPlan: string;
  feedback: string;
  expect: RevisionExpect;
}

export interface RevisionArmArtifacts {
  planContent: string | null;
  stepStatus: string;
}

export interface RevisionPairArtifacts {
  feedbackArm: RevisionArmArtifacts;
  controlArm: RevisionArmArtifacts;
}

export function isRevisionCase(input: {
  expect?: { kind?: string };
  priorPlan?: unknown;
  feedback?: unknown;
}): input is RevisionCase {
  return (
    input.expect?.kind === 'revision' &&
    typeof input.priorPlan === 'string' &&
    typeof input.feedback === 'string'
  );
}

const fold = (text: string): string => text.toLowerCase();

const missingMarkers = (text: string, markers: string[]): string[] => {
  const haystack = fold(text);
  return markers.filter((marker) => !haystack.includes(fold(marker)));
};

const presentMarkers = (text: string, markers: string[]): string[] => {
  const haystack = fold(text);
  return markers.filter((marker) => haystack.includes(fold(marker)));
};

function executed(arm: RevisionArmArtifacts): boolean {
  return arm.stepStatus === 'done' && (arm.planContent ?? '').trim() !== '';
}

function armChecks(
  input: RevisionCase,
  arm: RevisionArmArtifacts,
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (arm.stepStatus !== 'done') problems.push(`step not done: ${arm.stepStatus}`);
  const content = arm.planContent ?? '';
  if (content.trim().length < input.expect.minPlanChars)
    problems.push(`no plan artifact (${content.trim().length} chars)`);
  const changes = documentSection(content, 'Changes');
  if (changes === null) problems.push('no Changes section');
  const prescribed = changes ?? '';
  const rejected = presentMarkers(prescribed, input.expect.drop);
  if (rejected.length > 0)
    problems.push(
      `feedback ignored, the rejected approach is still prescribed: ${rejected.join(',')}`,
    );
  const missing = missingMarkers(prescribed, input.expect.defect);
  if (missing.length > 0) problems.push(`defect not addressed: ${missing.join(',')}`);
  const dropped = missingMarkers(content, input.expect.keep);
  if (dropped.length > 0)
    problems.push(`already-correct requirement dropped: ${dropped.join(',')}`);
  return { ok: problems.length === 0, problems };
}

export function gradeRevisionCase(
  input: RevisionCase,
  artifacts: RevisionPairArtifacts,
): { grade: Record<string, number>; explanation: Record<string, string> } {
  const feedbackArm = armChecks(input, artifacts.feedbackArm);
  const controlArm = armChecks(input, artifacts.controlArm);
  const feedbackRan = executed(artifacts.feedbackArm);
  const controlRan = executed(artifacts.controlArm);
  const grade: Record<string, number> = {
    revision_ok: feedbackRan && feedbackArm.ok ? 1 : 0,
    control_flipped: controlRan && !controlArm.ok ? 1 : 0,
  };
  const explanation: Record<string, string> = {
    revision_ok:
      !feedbackRan && feedbackArm.ok
        ? 'harness error: the feedback arm produced no artifact, so its requirements were not executed'
        : feedbackArm.ok
          ? 'revision addressed the defect, dropped the rejected approach and kept the test step'
          : feedbackArm.problems.join('; '),
    control_flipped: !controlRan
      ? 'harness error: the no-feedback arm produced no artifact, so it is not evidence of a failed control'
      : controlArm.ok
        ? 'no-feedback arm also produced an acceptable revision, so the case cannot attribute the fix to the feedback'
        : `no-feedback arm failed as expected: ${controlArm.problems.join('; ')}`,
  };
  return { grade, explanation };
}

export function gradeRevisionArm(
  input: RevisionCase,
  arm: RevisionArmArtifacts,
): { grade: Record<string, number>; explanation: Record<string, string> } {
  const checks = armChecks(input, arm);
  return {
    grade: { revision_arm_ok: checks.ok ? 1 : 0 },
    explanation: {
      revision_arm_ok: checks.ok ? 'arm met the revision requirements' : checks.problems.join('; '),
    },
  };
}

export function documentSection(content: string, heading: string): string | null {
  const lines = content.split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
}
