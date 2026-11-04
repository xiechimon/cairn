import { useState } from 'react';

export interface SendKey {
  keyFor(content: string): string;
  settle(): void;
}

export function createSendKey(): SendKey {
  let attempt: { content: string; key: string } | null = null;
  return {
    keyFor(content) {
      if (attempt?.content === content) return attempt.key;
      attempt = { content, key: crypto.randomUUID() };
      return attempt.key;
    },
    settle() {
      attempt = null;
    },
  };
}

export function useSendKey(): SendKey {
  return useState(createSendKey)[0];
}
