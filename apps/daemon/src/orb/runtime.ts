import type { OrbExecOptions, OrbExecResult } from './provider.js';

export type OrbRuntimeName = 'podman' | 'docker' | 'apple';

export interface OrbSpawnSpec {
  orbId: string;
  image: string;
  snapshotImage?: string;
  mounts: readonly { source: string; target: string; readonly: boolean }[];
  env: Readonly<Record<string, string>>;
  limits: { cpus: number; memoryBytes: number; pids: number };
  egress: { socketPath: string } | 'none';
  persistentHome?: { volume: string; target: string };
}

export interface OrbRuntimeState {
  orbId: string;
  image: string;
  state: 'running' | 'paused' | 'absent';
}

export interface OrbRuntime {
  readonly name: OrbRuntimeName;
  health(): Promise<{ version: string; rootless: boolean }>;
  buildImage(input: {
    contextDir: string;
    tag: string;
    buildArgs: Record<string, string>;
  }): Promise<void>;
  imageExists(ref: string): Promise<boolean>;
  spawn(spec: OrbSpawnSpec, options?: { signal?: AbortSignal }): Promise<void>;
  pause(orbId: string, options?: { snapshotImage?: string }): Promise<void>;
  remove(orbId: string): Promise<void>;
  list(): Promise<OrbRuntimeState[]>;
  exec(orbId: string, argv: readonly string[], options?: OrbExecOptions): Promise<OrbExecResult>;
  removeImage(ref: string): Promise<void>;
}
