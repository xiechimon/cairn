export interface StreamDrainSteps {
  drain: () => Promise<void>;
  release: () => void;
}

export function drainThenReleaseStreams(steps: StreamDrainSteps): Promise<void> {
  const draining = steps.drain();
  steps.release();
  return draining;
}
