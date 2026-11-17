import type { ComputerPresenceSource } from './presence.js';
import type { ScopedComputerProviders } from './provider.js';

export type ComputerKind = 'host' | 'vm';
export type ComputerHoldUse = 'view' | 'control' | 'handoff';

export interface ComputerDesktops extends ScopedComputerProviders, ComputerPresenceSource {
  readonly kind: ComputerKind;
  missingPrograms(): string[];
  offersBrowser(): boolean;
  offersStealthBrowser(): boolean;
  hold(scopeKey: string, use?: ComputerHoldUse): Promise<() => void>;
  socketPath(scopeKey: string, kind: 'view' | 'control'): string;
  sweep(): Promise<void>;
  close(): void;
}
