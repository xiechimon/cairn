import {
  type BoundGitCredentials,
  type ClaimedStep,
  type CommitIdentity,
  localCommitIdentity,
  type PreparedWorkspace,
  stepTakesSecrets,
} from '@cairn/shared';
import type { StepCredentials } from './credentials.js';
import type { DaemonLogger } from './log.js';
import type { MachineApi } from './machine-client.js';
import { type StepGitRunner, stepGitRunner } from './step-git-tools.js';
import { assembleStepLocalTools, type StepLocalTools } from './step-local-tools.js';
import { sessionInjectedSkills } from './step-skill-tool.js';
import type { StepRepo } from './step-workspace.js';
import { materializeTeamSkills } from './team-skills.js';

type StepAgent = NonNullable<ClaimedStep['agent']>;

export interface StepToolingInput {
  client: Pick<MachineApi, 'skillsManifest' | 'skillFile'>;
  claimed: ClaimedStep;
  agent: StepAgent;
  stepId: string;
  teamSkillsCacheDir: string;
  skillsDir: string | undefined;
  home: string;
  isPi: boolean;
  isChief: boolean;
  isReview: boolean;
  metered: boolean;
  creds: StepCredentials;
  appCredential: { needsRefresh(): boolean } | null;
  refreshGit: () => Promise<BoundGitCredentials>;
  commitIdentity: CommitIdentity | null;
  repo: StepRepo | null;
  ws: PreparedWorkspace | null;
  cwd: string;
  redact: (message: string) => string;
  logger: Pick<DaemonLogger, 'step' | 'skills'>;
}

export interface StepTooling {
  teamSkillsDir: string | null;
  stepIdentity: CommitIdentity;
  withStepGit: StepGitRunner;
  injectedSkills: StepAgent['injectedSkills'];
  localTools: StepLocalTools;
}

async function fetchTeamSkills(input: StepToolingInput): Promise<string | null> {
  const { client, stepId, logger } = input;
  const manifest = await client.skillsManifest(stepId);
  return materializeTeamSkills({
    cacheRoot: input.teamSkillsCacheDir,
    manifest,
    fetchFile: (dirName, path) => client.skillFile(stepId, dirName, path),
    log: (msg) => logger.skills(msg),
  });
}

export async function prepareStepTooling(
  input: StepToolingInput,
): Promise<StepTooling | { error: string }> {
  const { claimed, agent, stepId, logger, isPi, isChief, creds } = input;
  let teamSkillsDir: string | null;
  try {
    teamSkillsDir = await fetchTeamSkills(input);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.skills(`team-skills-failed: ${reason}`);
    return { error: `team skills distribution failed: ${reason}` };
  }
  const stepIdentity =
    input.commitIdentity ?? localCommitIdentity(agent.displayName ?? 'cairn-agent');
  const withStepGit = stepGitRunner({
    credential: creds.git,
    appCredential: input.appCredential,
    refresh: input.refreshGit,
    allowMachineFallback: input.repo?.kind === 'github',
    log: (line) => logger.step(line),
  });
  const injectedSkills = sessionInjectedSkills(agent);
  const localTools = assembleStepLocalTools({
    web: {
      enabled: isPi && !isChief && !input.isReview && claimed.remoteToolsOnly !== true,
      metered: input.metered,
      creds,
      stepId,
      home: input.home,
      log: (line) => logger.step(line),
    },
    secrets: stepTakesSecrets(claimed.step.kind)
      ? { stepId, agentId: agent.id ?? null, onAudit: (line) => logger.step(line) }
      : null,
    createTag: {
      localTools: claimed.localTools,
      repoDir: input.ws?.cwd ?? null,
      credential: creds.git,
      identity: stepIdentity,
      runGit: withStepGit,
      redact: input.redact,
    },
    skillLoad:
      isPi && input.skillsDir !== undefined
        ? {
            skillsDir: input.skillsDir,
            home: input.home,
            cwd: input.cwd,
            isChief,
            skillsAllowlist: agent.skillsAllowlist,
            injectedSkills,
            teamSkillsDir,
            log: (msg) => logger.skills(msg),
          }
        : null,
  });
  return { teamSkillsDir, stepIdentity, withStepGit, injectedSkills, localTools };
}
