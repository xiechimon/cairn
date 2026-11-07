import { HttpError } from '../lib/errors.js';

export const REJECTED_SPLIT_PROPOSAL_PREFIX = 'split-proposal-rejected:v1\n';
export const SPLIT_PROPOSAL_CORRECTION =
  'This rejected split proposal cannot be confirmed or executed.';

export function assertSplitProposalExecutable(errorMessage: string | null): void {
  if (errorMessage?.startsWith(REJECTED_SPLIT_PROPOSAL_PREFIX)) {
    throw new HttpError(409, SPLIT_PROPOSAL_CORRECTION);
  }
}
