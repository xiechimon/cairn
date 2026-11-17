export type SteerWithdrawResult = 'aborted' | 'already_placed' | 'settled' | 'not_found';

export const steerWithdrawals = new Map<
  string,
  (requestId: string) => Promise<SteerWithdrawResult>
>();
