import {
  type AgentTokenUsage,
  type ClaimedStep,
  type MachineDoneBody,
  type QuotaBlock,
  type SkillInjectionFacts,
  stripAnsiEscapes,
} from '@cairn/shared';
import type { TranscriptMessage } from './journal.js';
import { extractReviewVerdict } from './review-findings.js';
import { requireUploadedEvidence } from './step-outputs.js';
import { extractVerifyVerdict } from './verify-verdict.js';

export interface StepDoneOutcome {
  status: MachineDoneBody['status'];
  lastError: string | null;
  sessionId: string | null;
  usage: AgentTokenUsage;
  hasChanges: boolean;
  headCommit: string | null;
  preservedCommits: string[];
  pushHookOutput: string | null;
  prProbe: { number: number; url: string } | null;
  changesDiff: string | null;
  branchDrift: { expected: string; actual: string } | null;
  quotaBlock: QuotaBlock | null;
  skillInjectionFacts: SkillInjectionFacts | null;
  report: string | null;
}

export interface StepVerdictSource {
  kind: ClaimedStep['step']['kind'];
  messages: readonly TranscriptMessage[];
  attachmentVerify: boolean;
  uploadedEvidence: ReadonlySet<string>;
  cwd: string;
}

function stepVerdicts(source: StepVerdictSource): Partial<MachineDoneBody> {
  if (source.kind === 'review') {
    const review = extractReviewVerdict(source.messages);
    return review.status === 'ok' ? { findings: review.verdict } : { findingsError: review.reason };
  }
  if (source.kind !== 'verify') return {};
  const verify = extractVerifyVerdict(source.messages, { strict: source.attachmentVerify });
  if (verify.status === 'failed') return { verifyVerdictError: verify.reason };
  return {
    verifyVerdict: source.attachmentVerify
      ? requireUploadedEvidence(verify.verdict, source.uploadedEvidence, source.cwd)
      : verify.verdict,
  };
}

export function composeDoneBody(
  outcome: StepDoneOutcome,
  source: StepVerdictSource,
): MachineDoneBody {
  return {
    status: outcome.status,
    ...(outcome.lastError !== null ? { errorMessage: stripAnsiEscapes(outcome.lastError) } : {}),
    ...(outcome.sessionId !== null ? { sessionId: outcome.sessionId } : {}),
    usage: [...outcome.usage],
    hasChanges: outcome.hasChanges,
    ...(outcome.headCommit !== null ? { commit: outcome.headCommit } : {}),
    ...(outcome.preservedCommits.length > 0 ? { preservedCommits: outcome.preservedCommits } : {}),
    ...(outcome.pushHookOutput !== null ? { pushHookOutput: outcome.pushHookOutput } : {}),
    ...stepVerdicts(source),
    ...(outcome.prProbe !== null
      ? { prUrl: outcome.prProbe.url, prNumber: outcome.prProbe.number }
      : {}),
    ...(outcome.changesDiff !== null ? { changesDiff: outcome.changesDiff } : {}),
    ...(outcome.branchDrift !== null ? { workBranchDrift: outcome.branchDrift } : {}),
    ...(outcome.quotaBlock !== null ? { quotaBlock: outcome.quotaBlock } : {}),
    ...(outcome.skillInjectionFacts !== null
      ? { skillInjectionFacts: outcome.skillInjectionFacts }
      : {}),
    ...(outcome.report !== null ? { report: outcome.report } : {}),
    ...(outcome.status === 'success' && !source.messages.some((m) => m.role === 'assistant')
      ? { noOutput: true as const }
      : {}),
  };
}
