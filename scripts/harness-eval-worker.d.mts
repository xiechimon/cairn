export type PublishEvaluationRequest = {
  repo: string;
  pr: string;
  ticket: string;
  expectedHead: string;
  patchDigest: string;
};

export type PublishEvaluationDependencies = {
  remote: string;
  tempRoot?: string;
  branch?: string;
  author?: { name: string; email: string };
  verifyRequest: (
    request: PublishEvaluationRequest,
  ) =>
    | { head: string; branch: string; patchDigest: string }
    | Promise<{ head: string; branch: string; patchDigest: string }>;
  evaluate: (context: {
    checkout: string;
    output: string;
    request: PublishEvaluationRequest;
  }) => void | Promise<void>;
  observe?: (args: string[]) => void;
};

export function publishEvaluation(
  request: PublishEvaluationRequest,
  dependencies: PublishEvaluationDependencies,
): Promise<{ commit: string; branch: string; result: unknown }>;
