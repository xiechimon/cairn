import { checkPlanContract, planPriorArtDecisions } from '@cairn/shared';

export interface PriorArtGrade {
  score: number;
  explanation: string;
}

const CRONER_TARGET =
  /^croner\b(?=\s*(?:$|[,(，]|because\b|rather than\b|instead of\b|因为|而不是))/i;
const REJECTS_CRONER = /\b(?:not|never|don['’]t|won['’]t)\s+re-?use\s+croner\b|不复用\s*croner\b/i;

export function gradePlanPriorArt(plan: string): PriorArtGrade {
  const contract = checkPlanContract(plan);
  if (!contract.ok) {
    return { score: 0, explanation: 'hand-rolled plan failed the prior-art contract' };
  }
  const decisions = planPriorArtDecisions(plan) ?? [];
  const choices = decisions.flatMap((decision) => decision.choices);
  const reusesCroner =
    !decisions.some((decision) => REJECTS_CRONER.test(decision.text)) &&
    choices.some((choice) => choice.kind === 'reuse' && CRONER_TARGET.test(choice.subject)) &&
    choices.every(
      (choice) =>
        choice.kind === 'reject-build' ||
        (choice.kind === 'reuse' && CRONER_TARGET.test(choice.subject)) ||
        (choice.kind === 'reject-reuse' && !/^croner\b/i.test(choice.subject)),
    );
  if (reusesCroner) {
    return { score: 1, explanation: 'reuses croner and the prior-art contract passes' };
  }
  return { score: 0.5, explanation: 'contract passes without reusing the known library' };
}
