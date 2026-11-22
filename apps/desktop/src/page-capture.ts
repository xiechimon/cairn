export const PAGE_CAPTURE_BUDGET_MS = 10_000;

export interface CaptureSurface {
  load(html: string): Promise<void>;
  nextFrame(): Promise<Uint8Array>;
  destroy(): void;
}

export type CapturePage = (html: string) => Promise<Uint8Array | null>;

export function createPageCapture(
  open: () => CaptureSurface,
  budgetMs = PAGE_CAPTURE_BUDGET_MS,
): CapturePage {
  let queue: Promise<unknown> = Promise.resolve();
  const captureOnce = async (html: string): Promise<Uint8Array | null> => {
    const surface = open();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const overBudget = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), budgetMs);
    });
    try {
      return await Promise.race([surface.load(html).then(() => surface.nextFrame()), overBudget]);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      surface.destroy();
    }
  };
  return (html) => {
    const run = queue.then(() => captureOnce(html));
    queue = run;
    return run;
  };
}
