import { toast } from 'sonner';

type Listener = () => void;

const DISMISS_UNDO_MS = 5000;

const dismissing = new Map<string, ReturnType<typeof setTimeout>>();
const committing = new Set<string>();
const listeners = new Set<Listener>();
let version = 0;

function emit(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export const questionState = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  snapshot(): number {
    return version;
  },
  isDismissing(requestId: string): boolean {
    return dismissing.has(requestId) || committing.has(requestId);
  },
  dismissWithUndo(
    requestId: string,
    copy: { title: string; undo: string },
    commit: () => unknown,
  ): void {
    if (dismissing.has(requestId) || committing.has(requestId)) return;
    const timer = setTimeout(() => {
      dismissing.delete(requestId);
      committing.add(requestId);
      emit();
      Promise.resolve(commit())
        .catch((error) => {
          console.debug('cairn: recoverable operation failed', error);
        })
        .finally(() => {
          committing.delete(requestId);
          emit();
        });
    }, DISMISS_UNDO_MS);
    dismissing.set(requestId, timer);
    emit();
    toast(copy.title, {
      duration: DISMISS_UNDO_MS,
      action: {
        label: copy.undo,
        onClick: () => {
          clearTimeout(dismissing.get(requestId));
          dismissing.delete(requestId);
          emit();
        },
      },
    });
  },
};
