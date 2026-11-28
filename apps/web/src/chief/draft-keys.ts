export const CHIEF_DRAFT_STORAGE_KEY = 'cairn.chief-draft';

export function chiefDraftKeys(projectId: string | null): { scope: string; localKey: string } {
  return projectId === null
    ? { scope: 'chief', localKey: CHIEF_DRAFT_STORAGE_KEY }
    : { scope: `chief:${projectId}`, localKey: `${CHIEF_DRAFT_STORAGE_KEY}.${projectId}` };
}
