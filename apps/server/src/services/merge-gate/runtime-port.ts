import type {
  buildReviewStepPrompt,
  MergeGateRun,
  MergePolicy,
  parseGithubIssueSourceRef,
  parseReviewPromptMeta,
  ReviewVerdict,
  VerifyVerdict,
} from '@cairn/shared';
import type {
  agent,
  build,
  chief,
  gateDigest,
  gateRound,
  gateState,
  gateVerdict,
  message,
  project,
  step,
  todo,
} from '../../db/schema.js';
import type { GateAuditIssuePort } from './audit.js';
import type { GateGithubPort } from './github-port.js';

type BuildRow = typeof build.$inferSelect;
type TodoRow = typeof todo.$inferSelect;
type ProjectRow = typeof project.$inferSelect;
type RoundRow = typeof gateRound.$inferSelect;
type StateRow = typeof gateState.$inferSelect;

export interface GateRuntimePort {
  readBuild(id: string): BuildRow | undefined;
  readTodo(id: string): TodoRow | undefined;
  readProject(todo: TodoRow): ProjectRow | undefined;
  projectRepo(project: ProjectRow | undefined): { owner: string; repo: string } | null;
  projectPolicy(project: ProjectRow): MergePolicy;
  readSteps(buildId: string): (typeof step.$inferSelect)[];
  readAgents(teamId: string): (typeof agent.$inferSelect)[];
  readVerdicts(buildId: string): (typeof gateVerdict.$inferSelect)[];
  readMessages(buildId: string): (typeof message.$inferSelect)[];
  readChief(teamId: string): typeof chief.$inferSelect | undefined;
  readState(buildId: string): StateRow | undefined;
  bindVerdictDigest(stepId: string, digest: string): void;
  insertDigest(row: typeof gateDigest.$inferInsert): void;
  readRounds(buildId: string): RoundRow[];
  insertRound(row: typeof gateRound.$inferInsert): void;
  updateRound(id: string, values: Pick<RoundRow, 'state' | 'perspectives' | 'dispatches'>): void;
  saveState(row: StateRow): void;
  githubPort(teamId: string, repo: { owner: string; repo: string }): Promise<GateGithubPort | null>;
  auditPort(
    teamId: string,
    repo: { owner: string; repo: string },
    prNumber: number,
  ): Promise<GateAuditIssuePort | null>;
  parseIssueRef(text: string): ReturnType<typeof parseGithubIssueSourceRef>;
  parseReviewMeta(text: string | null): ReturnType<typeof parseReviewPromptMeta>;
  parseReviewVerdict(value: unknown): ReviewVerdict | null;
  parseVerifyVerdict(value: unknown): VerifyVerdict | null;
  reviewPrompt(args: Parameters<typeof buildReviewStepPrompt>[0]): string;
  enqueueReview(buildId: string, teamId: string, prompt: string): void;
  now(): number;
  newId(): string;
  hasAuditStorage: boolean;
  readSession(stepId: string): string | null;
  readRuns(buildId: string): MergeGateRun[];
  appendRun(run: MergeGateRun): void;
}
