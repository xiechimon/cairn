import { checkPlanContract, planPriorArtLines } from '@cairn/shared';

export interface PriorArtGrade {
  score: number;
  explanation: string;
}

const REUSES_CRONER =
  /^(?:(?:we\s+)?(?:will\s+|choose\s+to\s+|plan\s+to\s+)?)re-?use\s+croner\b|^(?:决定)?复用\s*croner\b/i;
const REJECTS_CRONER = /\b(?:not|never|don['’]t|won['’]t)\s+re-?use\s+croner\b|不复用\s*croner\b/i;

export function gradePlanPriorArt(plan: string): PriorArtGrade {
  const contract = checkPlanContract(plan);
  if (!contract.ok) {
    return { score: 0, explanation: 'hand-rolled plan failed the prior-art contract' };
  }
  const decisions = (planPriorArtLines(plan) ?? [])
    .filter((line) => !line.startsWith('>'))
    .map((line) =>
      line
        .replace(/[`*_]/g, '')
        .replace(/^(?:[-•]\s+|\d+[.)]\s+)/, '')
        .replace(/^(?:decision|决策|决定)\s*[:：]\s*/i, ''),
    )
    .filter((line) => !/^[A-Za-z]+\s*[:：]/.test(line));
  const reusesCroner =
    !decisions.some((line) => REJECTS_CRONER.test(line)) &&
    decisions.some((line) =>
      line.split(/[;；。]/).some((clause) => REUSES_CRONER.test(clause.trim())),
    );
  if (reusesCroner) {
    return { score: 1, explanation: 'reuses croner and the prior-art contract passes' };
  }
  return { score: 0.5, explanation: 'contract passes without reusing the known library' };
}
