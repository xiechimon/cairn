interface EvaluationContext {
  observation: {
    input: unknown;
    output: unknown;
    metadata: unknown;
    toolCalls: unknown[];
  };
  experiment?: {
    itemExpectedOutput: unknown;
    itemMetadata: unknown;
  };
}

interface EvaluationScore {
  name: string;
  value: boolean;
  dataType: 'BOOLEAN';
  comment: string;
}

interface EvaluationResult {
  scores: EvaluationScore[];
}
