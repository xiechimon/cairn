import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { BoundGitCredentials } from '@cairn/shared';
import { gitCredentialEnv } from './git.js';
import { ensurePrivateDir, writePrivateFile } from './private-fs.js';

export class StepAppCredential {
  private credential: BoundGitCredentials;
  private readonly timer: ReturnType<typeof setInterval>;
  private pending: Promise<BoundGitCredentials> | null = null;
  private disposed = false;
  private readonly tokenFile: string;
  private readonly configDir: string;

  constructor(
    private readonly dir: string,
    credential: BoundGitCredentials,
    private readonly fetchCredential: () => Promise<BoundGitCredentials>,
    private readonly remember: (value: string) => void,
    private readonly now: () => number = Date.now,
    private readonly onError: () => void = () => undefined,
  ) {
    this.tokenFile = join(dir, 'github-token');
    this.configDir = join(dir, 'gh');
    this.credential = credential;
    try {
      ensurePrivateDir(dir);
      ensurePrivateDir(this.configDir);
      this.replace(credential);
    } catch (error) {
      rmSync(dir, { recursive: true, force: true });
      throw error;
    }
    this.timer = setInterval(() => {
      if (this.needsRefresh()) void this.refresh().catch(() => this.onError());
    }, 60_000);
    this.timer.unref?.();
  }

  current(): BoundGitCredentials {
    return this.credential;
  }

  needsRefresh(): boolean {
    return (this.credential.expiresAt ?? 0) - this.now() < 15 * 60_000;
  }

  env(): Record<string, string> {
    return {
      ...Object.fromEntries(
        Object.entries(gitCredentialEnv(this.credential)).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
      GH_CONFIG_DIR: this.configDir,
    };
  }

  refresh(): Promise<BoundGitCredentials> {
    if (this.disposed) return Promise.reject(new Error('App credential already cleaned up'));
    if (this.pending !== null) return this.pending;
    this.pending = this.fetchCredential()
      .then((credential) => {
        if (this.disposed) throw new Error('App credential already cleaned up');
        this.replace(credential);
        return this.credential;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  dispose(): void {
    this.disposed = true;
    clearInterval(this.timer);
    rmSync(this.dir, { recursive: true, force: true });
  }

  private replace(credential: BoundGitCredentials): void {
    this.remember(credential.password);
    if (credential.kind !== 'app' || /[\r\n\0]/.test(credential.password))
      throw new Error('App credential refresh unavailable');
    writePrivateFile(this.tokenFile, credential.password);
    writePrivateFile(
      join(this.configDir, 'hosts.yml'),
      JSON.stringify({
        [new URL(credential.url).hostname]: {
          oauth_token: credential.password,
          git_protocol: 'https',
        },
      }),
    );
    Object.assign(this.credential, {
      ...credential,
      expiresAt: credential.expiresAt ?? this.now() + 60 * 60_000,
      passwordFile: this.tokenFile,
    });
  }
}
