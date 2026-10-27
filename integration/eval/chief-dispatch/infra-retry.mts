import { MAX_INFRA_RETRIES } from '../adoption/judge.mts';

export function isHarnessInfraError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { failure_class?: unknown }).failure_class === 'harness_error'
  );
}

export async function retryHarnessInfra<T>(
  run: () => Promise<T>,
  retry: { count: number },
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (!isHarnessInfraError(error) || attempt >= MAX_INFRA_RETRIES) throw error;
      retry.count += 1;
    }
  }
}
