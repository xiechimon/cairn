import {
  FAILURE_WHERE,
  FAILURE_WHY,
  failureWhereSchema,
  failureWhySchema,
  type TrajectoryPack,
  trajectoryPackSchema,
} from '@cairn/shared';
import { z } from 'zod';

export class AttributionError extends Error {}

export interface LabelerEndpoint {
  baseUrl: string;
  apiKey: string;
}

export interface LabelSummary {
  labeled: number;
  alreadyLabeled: number;
  notFailed: number;
}

const verdictSchema = z.object({
  where: failureWhereSchema,
  why: failureWhySchema,
  evidence: z.array(z.object({ stepId: z.string(), messageIndex: z.number().int().nonnegative() })),
});

const SYSTEM_PROMPT = [
  'You classify why an AI coding agent run failed. Read the trajectory and answer with one JSON object:',
  '{"where": <layer>, "why": <reason>, "evidence": [{"stepId": <step id>, "messageIndex": <index shown in the trajectory>}]}',
  `where is the layer to change: ${FAILURE_WHERE.join(' | ')}.`,
  'prompt = instructions and prompt assembly. knowledge = skills, memory, retrieved context.',
  'runtime = control loop, hooks, recovery, tool calls. config = numeric parameters, routing, model choice. infra = cause outside the agent. unknown = cannot tell.',
  `why is one of: ${FAILURE_WHY.join(' | ')}.`,
  'evidence must cite the concrete steps and message indexes that show the failure.',
].join('\n');

export const bareModelId = (model: string) => model.slice(model.lastIndexOf('/') + 1);

export function isFailedPack(pack: TrajectoryPack) {
  const outcome = pack.outcome;
  return (
    outcome !== null &&
    (outcome.merged === false ||
      outcome.revertedWithin7d === true ||
      outcome.fixedByLaterPr === true)
  );
}

export async function labelPacks(
  lines: string[],
  options: { model: string; endpoint: LabelerEndpoint; now: () => number },
) {
  const packs = lines.map((line) => trajectoryPackSchema.parse(JSON.parse(line)));
  const labelerId = bareModelId(options.model);
  for (const pack of packs) {
    if (
      isFailedPack(pack) &&
      pack.attribution === null &&
      bareModelId(pack.input.model) === labelerId
    )
      throw new AttributionError(
        `Labeler must differ from the tested model (${pack.buildId} ran ${pack.input.model})`,
      );
  }
  const summary: LabelSummary = { labeled: 0, alreadyLabeled: 0, notFailed: 0 };
  const labeledPacks: TrajectoryPack[] = [];
  for (const pack of packs) {
    if (!isFailedPack(pack)) {
      summary.notFailed++;
      labeledPacks.push(pack);
      continue;
    }
    if (pack.attribution !== null) {
      summary.alreadyLabeled++;
      labeledPacks.push(pack);
      continue;
    }
    try {
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
                  spec: pack.input.spec,
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
      if (!response.ok) throw new AttributionError(`labeler HTTP ${response.status}`);
      const body: unknown = await response.json();
      const content = z
        .object({
          choices: z
            .tuple([z.object({ message: z.object({ content: z.string() }) })])
            .rest(z.unknown()),
        })
        .parse(body).choices[0].message.content;
      const verdict = verdictSchema.parse(JSON.parse(content));
      for (const ref of verdict.evidence) {
        const cited = pack.process.steps.find((step) => step.stepId === ref.stepId);
        if (cited === undefined || ref.messageIndex >= cited.transcript.length)
          throw new AttributionError(
            `evidence ${ref.stepId}#${ref.messageIndex} not in trajectory`,
          );
      }
      labeledPacks.push({
        ...pack,
        attribution: { ...verdict, labeler: options.model, labeledAt: options.now() },
      });
      summary.labeled++;
    } catch (error) {
      const reason =
        error instanceof AttributionError
          ? error.message
          : error instanceof z.ZodError
            ? `verdict invalid at ${error.issues.map((issue) => issue.path.join('.') || '(root)').join(', ')}`
            : error instanceof SyntaxError
              ? 'verdict is not JSON'
              : 'labeler request failed';
      throw new AttributionError(`Labeling ${pack.buildId} failed: ${reason}`);
    }
  }
  return { lines: labeledPacks.map((pack) => JSON.stringify(pack)), summary };
}

export function summarizeAttribution(lines: string[]) {
  const counts = new Map<string, number>();
  let unlabeled = 0;
  for (const line of lines) {
    const { attribution } = trajectoryPackSchema.parse(JSON.parse(line));
    if (attribution === null) {
      unlabeled++;
      continue;
    }
    const key = `${attribution.where}\t${attribution.why}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const position = (key: string) => {
    const [where, why] = key.split('\t');
    return [
      FAILURE_WHERE.indexOf(where as (typeof FAILURE_WHERE)[number]),
      FAILURE_WHY.indexOf(why as (typeof FAILURE_WHY)[number]),
    ] as const;
  };
  const rows = [...counts].sort(([a, countA], [b, countB]) => {
    const [whereA, whyA] = position(a);
    const [whereB, whyB] = position(b);
    return countB - countA || whereA - whereB || whyA - whyB;
  });
  return [
    'where\twhy\tcount',
    ...rows.map(([key, count]) => `${key}\t${count}`),
    `total=${lines.length} unlabeled=${unlabeled}`,
    '',
  ].join('\n');
}
