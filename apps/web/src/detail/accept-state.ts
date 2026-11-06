export interface AcceptInput {
  infoOutput: boolean;
  substantiveChanges: boolean | null | undefined;
  locked: boolean;
  missingTools: readonly string[];
}

export interface AcceptState {
  skipMerge: boolean;
  permissionMissing: boolean;
  mergeChecked: boolean;
  mergeDisabled: boolean;
  confirmDisabled: boolean;
  merge: boolean;
}

export function acceptState(input: AcceptInput, wantsMerge: boolean): AcceptState {
  const skipMerge = input.infoOutput || (input.substantiveChanges === false && !input.locked);
  const permissionMissing = !skipMerge && input.missingTools.length > 0;
  const mergeChecked = !permissionMissing && (input.locked || wantsMerge);
  return {
    skipMerge,
    permissionMissing,
    mergeChecked,
    mergeDisabled: input.locked || permissionMissing,
    confirmDisabled: permissionMissing && input.locked,
    merge: !skipMerge && mergeChecked,
  };
}
