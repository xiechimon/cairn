import { checkPlanContract } from '@cairn/shared';

export interface PriorArtGrade {
  score: number;
  explanation: string;
}

const REUSES_CRONER =
  /\breuse\b[\s\S]{0,160}\bcroner\b|\bcroner\b[\s\S]{0,160}\breuse\b|复用[\s\S]{0,80}croner/i;

export function gradePlanPriorArt(plan: string): PriorArtGrade {
  const contract = checkPlanContract(plan);
  if (contract.ok && REUSES_CRONER.test(plan)) {
    return { score: 1, explanation: 'reuses croner and the prior-art contract passes' };
  }
  if (!contract.ok) {
    return { score: 0, explanation: 'hand-rolled plan failed the prior-art contract' };
  }
  return { score: 0.5, explanation: 'contract passes without reusing the known library' };
}
