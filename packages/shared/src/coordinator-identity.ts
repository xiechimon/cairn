export function coordinatorConversationKey(storeId: string, conversationId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(storeId) || !/^\d+$/.test(conversationId))
    throw new Error('Invalid Coordinator conversation identity');
  return `${storeId}:${conversationId}`;
}

export function parseCoordinatorConversationKey(
  value: string,
): { storeId: string; conversationId: string } | null {
  const match = /^([A-Za-z0-9_-]+):(\d+)$/.exec(value);
  return match?.[1] !== undefined && match[2] !== undefined
    ? { storeId: match[1], conversationId: match[2] }
    : null;
}

export function coordinatorTextSourceId(stepId: string, entryId: string, storeId?: string): string {
  return `${storeId === undefined ? '' : `native-${storeId}:`}${stepId}-e${entryId}`;
}

export function parseCoordinatorTextSourceId(
  value: string,
): { stepId: string; entryId: string; storeId: string | null } | null {
  const native = /^native-([A-Za-z0-9_-]+):(.+)-e(\d+)$/.exec(value);
  if (native?.[1] !== undefined && native[2] !== undefined && native[3] !== undefined)
    return { storeId: native[1], stepId: native[2], entryId: native[3] };
  const legacy = /^(.+)-e(\d+)$/.exec(value);
  return legacy?.[1] !== undefined && legacy[2] !== undefined
    ? { storeId: null, stepId: legacy[1], entryId: legacy[2] }
    : null;
}

export function coordinatorToolSourceId(storeId: string, callId: string): string {
  return `native-${storeId}:${callId}`;
}
