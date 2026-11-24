export function recordUnstubbedNetworkCall(call: string, suite?: string): Error;
export function takeUnstubbedNetworkCalls(): string[];
export function installNetworkGuard(options?: { suite?: string }): void;
