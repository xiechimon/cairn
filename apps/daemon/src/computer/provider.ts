export type ComputerProcessEvent =
  | { kind: 'stdout' | 'stderr'; text: string }
  | { kind: 'exit'; code: number; reason?: 'timeout' | 'aborted' };

export interface ComputerExecuteRequest {
  argv: readonly string[];
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  timeoutMs: number;
  signal: AbortSignal;
}

export interface ComputerFileEntry {
  path: string;
  kind: 'file' | 'dir';
  size: number;
  executable?: true;
}

export class ComputerRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComputerRefusal';
  }
}

export interface ComputerProvider {
  execute(request: ComputerExecuteRequest): Promise<AsyncIterable<ComputerProcessEvent>>;
  listFiles(path: string): Promise<ComputerFileEntry[]>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  killAll(): Promise<void>;
}
