import { useState } from 'react';

export interface SendAttempt<Route extends string> {
  key: string;
  route: Route;
}

export interface SendKey {
  attempt<Route extends string>(identity: string, route: Route): SendAttempt<Route>;
  settle(): void;
}

export function createSendKey(): SendKey {
  let current: { identity: string; key: string; route: string } | null = null;
  return {
    attempt<Route extends string>(identity: string, route: Route): SendAttempt<Route> {
      if (current?.identity !== identity) {
        current = { identity, key: crypto.randomUUID(), route };
      }
      return { key: current.key, route: current.route as Route };
    },
    settle() {
      current = null;
    },
  };
}

export function useSendKey(): SendKey {
  return useState(createSendKey)[0];
}
