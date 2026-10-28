export function evalResumeArmKey(input: {
  planArm?: string;
  isLearn: boolean;
  learnArm?: string;
}): string {
  if (input.planArm !== undefined) return input.planArm;
  if (input.isLearn && input.learnArm !== undefined) return input.learnArm;
  return '';
}

export function evalResumeDoneKey(promptId: string, rep: number, armKey: string): string {
  return `${promptId}\0${rep}\0${armKey}`;
}
