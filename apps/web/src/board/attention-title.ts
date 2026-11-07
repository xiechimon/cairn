import { useEffect } from 'react';

const BASE_TITLE = 'Cairn';

export function attentionTitle(count: number): string {
  return Number.isFinite(count) && count > 0 ? `(${Math.floor(count)}) ${BASE_TITLE}` : BASE_TITLE;
}

export function useAttentionTitle(count: number): void {
  useEffect(() => {
    document.title = attentionTitle(count);
    return () => {
      document.title = BASE_TITLE;
    };
  }, [count]);
}
