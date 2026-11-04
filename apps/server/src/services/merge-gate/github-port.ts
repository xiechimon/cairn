export type GateRawFailure =
  | { kind: 'invalid'; field: string }
  | { kind: 'timeout' }
  | { kind: 'network' }
  | {
      kind: 'rate-limited';
      status: number;
      resetAt: number | null;
      retryAfterSeconds: number | null;
    }
  | { kind: 'status'; status: number; message: string | null }
  | { kind: 'not-json' };

export type GateRaw =
  | { kind: 'ok'; status: number; etag: string | null; link: string | null; body: unknown }
  | { kind: 'not-modified' }
  | { kind: 'failed'; failure: GateRawFailure };

export type GateStatusState = 'error' | 'failure' | 'pending' | 'success';

export interface GateGithubPort {
  pull(prNumber: number, o: { etag: string | null }): Promise<GateRaw>;
  branch(name: string, o: { etag: string | null }): Promise<GateRaw>;
  branchRules(
    name: string,
    o: { page: number; perPage: number; etag: string | null },
  ): Promise<GateRaw>;
  compare(base: string, head: string, o: { page: number; perPage: number }): Promise<GateRaw>;
  checkRuns(
    sha: string,
    o: { filter: 'latest'; page: number; perPage: number; etag: string | null },
  ): Promise<GateRaw>;
  combinedStatus(
    sha: string,
    o: { page: number; perPage: number; etag: string | null },
  ): Promise<GateRaw>;
  contents(path: string, ref: string): Promise<GateRaw>;
  createStatus(
    sha: string,
    s: { state: GateStatusState; context: string; description: string },
  ): Promise<GateRaw>;
}
