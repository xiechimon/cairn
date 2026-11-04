import {
  type ExperienceCandidate,
  experienceProposalSchema,
  fenceIssueText,
  ISSUE_FENCE_OPEN,
  parseGithubIssueSourceRef,
  type TrajectoryPack,
  trajectoryPackSchema,
} from '@cairn/shared';
import { z } from 'zod';
import { isFailedPack } from './trajectory-attribution.js';

export class ReflectError extends Error {}

export interface ReflectorEndpoint {
  baseUrl: string;
  apiKey: string;
}

const ISSUE_LINE_MIN_CHARS = 20;

const SYSTEM_PROMPT = [
  'You read the trajectory of an AI coding agent run that failed first and then went green, or was sent back by a human reviewer.',
  'Extract lessons that would help a later run of a different task in the same project. Answer with one JSON object:',
  '{"candidates": [{"kind": "memory" | "skill" | "guard", "title": <short title>, "content": <the lesson>, "skill": <skill name, only for kind skill>, "evidence": [{"stepId": <step id>, "messageIndex": <index shown in the trajectory>}]}]}',
  'memory = a project fact or working habit (commands, paths, conventions). skill = a procedure to append to the named skill file. guard = a check that could be automated so the mistake cannot recur.',
  'Only keep lessons that generalise beyond this task. Do not copy the task text or any GitHub issue text. An empty list is a valid answer.',
  'evidence must cite the concrete steps and message indexes where the lesson shows.',
].join('\n');

const replySchema = z.object({ candidates: z.array(z.unknown()) });

export function isReflectEligible(pack: TrajectoryPack) {
  const sentBack =
    pack.judgments.plan.some((j) => j.action === 'revision') ||
    pack.judgments.diff.some((j) => j.action !== 'approve');
  const turnedGreen =
    pack.judgments.ciFixRounds > 0 && pack.outcome?.merged === true && !isFailedPack(pack);
  return sentBack || turnedGreen;
}

const normalizeQuoted = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim();

export async function reflectPacks(
  lines: string[],
  options: { model: string; endpoint: ReflectorEndpoint; now: () => number },
) {
  const packs = lines.map((line) => trajectoryPackSchema.parse(JSON.parse(line)));
  const summary = { reflected: 0, notEligible: 0, candidates: 0, rejected: 0 };
  const out: ExperienceCandidate[] = [];
  for (const pack of packs) {
    if (!isReflectEligible(pack)) {
      summary.notEligible++;
      continue;
    }
    try {
      const issueSourced =
        pack.input.sourceRef !== null && parseGithubIssueSourceRef(pack.input.sourceRef) !== null;
      const issueLines = issueSourced
        ? pack.input.spec
            .split('\n')
            .map(normalizeQuoted)
            .filter((line) => line.length >= ISSUE_LINE_MIN_CHARS)
        : [];
      const response = await fetch(
        `${options.endpoint.baseUrl.replace(/\/$/, '')}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${options.endpoint.apiKey}`,
          },
          body: JSON.stringify({
            model: options.model,
            temperature: 0,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              {
                role: 'user',
                content: JSON.stringify({
                  buildId: pack.buildId,
                  spec: issueSourced
                    ? fenceIssueText(pack.input.sourceRef, pack.input.spec)
                    : pack.input.spec,
                  outcome: pack.outcome,
                  judgments: pack.judgments,
                  steps: pack.process.steps.map((step) => ({
                    stepId: step.stepId,
                    kind: step.kind,
                    messages: step.transcript.map((message, messageIndex) => ({
                      messageIndex,
                      ...message,
                    })),
                  })),
                }),
              },
            ],
          }),
        },
      );
      if (!response.ok) throw new ReflectError(`reflector HTTP ${response.status}`);
      const body: unknown = await response.json();
      const content = z
        .object({
          choices: z
            .tuple([z.object({ message: z.object({ content: z.string() }) })])
            .rest(z.unknown()),
        })
        .parse(body).choices[0].message.content;
      const proposals = replySchema
        .parse(JSON.parse(content))
        .candidates.map((raw) => experienceProposalSchema.parse(raw));
      for (const proposal of proposals) {
        for (const ref of proposal.evidence) {
          const cited = pack.process.steps.find((step) => step.stepId === ref.stepId);
          if (cited === undefined || ref.messageIndex >= cited.transcript.length)
            throw new ReflectError(`evidence ${ref.stepId}#${ref.messageIndex} not in trajectory`);
        }
      }
      for (const proposal of proposals) {
        const text = `${proposal.title}\n${proposal.content}`;
        const quoted = normalizeQuoted(text);
        if (text.includes(ISSUE_FENCE_OPEN) || issueLines.some((line) => quoted.includes(line))) {
          summary.rejected++;
          continue;
        }
        out.push({
          ...proposal,
          buildId: pack.buildId,
          agentId: pack.input.agentId,
          buildSucceeded: pack.outcome?.merged === true && !isFailedPack(pack),
          reflector: options.model,
          reflectedAt: options.now(),
        });
        summary.candidates++;
      }
      summary.reflected++;
    } catch (error) {
      const reason =
        error instanceof ReflectError
          ? error.message
          : error instanceof z.ZodError
            ? `reflection invalid at ${error.issues.map((issue) => issue.path.join('.') || '(root)').join(', ')}`
            : error instanceof SyntaxError
              ? 'reflection is not JSON'
              : 'reflector request failed';
      throw new ReflectError(`Reflecting ${pack.buildId} failed: ${reason}`);
    }
  }
  return { lines: out.map((candidate) => JSON.stringify(candidate)), summary };
}
