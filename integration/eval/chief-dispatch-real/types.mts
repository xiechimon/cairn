export type DispatchOutcome = 'reassigned' | 'cancelled' | 'failed';

export interface SnapshotAgent {
  id: string;
  key: string;
  displayName: string;
  description: string;
}

export interface SnapshotProject {
  id: string;
  name: string;
  description: string;
  agents: SnapshotAgent[];
}

export interface ExportedDispatchCase {
  caseId: string;
  prompt: string;
  projectsSnapshot: SnapshotProject[];
  dispatchedTo: { agentId: string; displayName: string; key: string } | null;
  outcome: DispatchOutcome;
}

export interface LabeledDispatchCase {
  id: string;
  tags: string[];
  prompt: string;
  expect: { kind: 'dispatch'; agent: string };
  roster: Array<{
    key: string;
    displayName: string;
    modelId: string;
    description: string;
  }>;
}

export interface EvalFlowFile {
  flow: string;
  roster: LabeledDispatchCase['roster'];
  cases: Array<{
    id: string;
    tags: string[];
    prompt: string;
    expect: { kind: 'dispatch'; agent: string };
  }>;
}
