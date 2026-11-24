import type { ComputerManageAction, ComputerManageOutcome } from '@cairn/shared';

export type ComputerProcessEvent =
  | { kind: 'stdout' | 'stderr'; text: string }
  | { kind: 'exit'; code: number; reason?: 'timeout' | 'aborted'; delivery?: 'not_delivered' };

export interface ComputerExecuteRequest {
  argv: readonly string[];
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  stdin?: string;
  timeoutMs: number;
  signal: AbortSignal;
  unsandboxed?: boolean;
}

export interface ComputerFileEntry {
  path: string;
  kind: 'file' | 'dir';
  size: number;
  executable?: true;
}

export interface ComputerFileOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export class ComputerRefusal extends Error {
  readonly delivery: 'not_delivered' | 'unknown';

  constructor(message: string, delivery: 'not_delivered' | 'unknown' = 'not_delivered') {
    super(message);
    this.name = 'ComputerRefusal';
    this.delivery = delivery;
  }
}

export interface ComputerProvider {
  execute(request: ComputerExecuteRequest): Promise<AsyncIterable<ComputerProcessEvent>>;
  listFiles(path: string, options?: ComputerFileOptions): Promise<ComputerFileEntry[]>;
  readFile(path: string, options?: ComputerFileOptions): Promise<string>;
  writeFile(path: string, content: string, options?: ComputerFileOptions): Promise<void>;
  killAll(): Promise<void>;
}

export interface ComputerScopeGrant {
  browserLicense?: string;
}

export interface ComputerPackageInstallOptions {
  timeoutMs: number;
  signal: AbortSignal;
  output: (stream: 'stdout' | 'stderr', text: string) => void;
}

export interface ScopedComputerProviders {
  readonly hostRoot?: string;
  forScope(scopeKey: string, grant?: ComputerScopeGrant): ComputerProvider;
  killAll(): Promise<void>;
  installPackages?(
    scopeKey: string,
    packages: readonly string[],
    options: ComputerPackageInstallOptions,
  ): Promise<number>;
  manage?(scopeKey: string, action: ComputerManageAction): Promise<ComputerManageOutcome>;
}
