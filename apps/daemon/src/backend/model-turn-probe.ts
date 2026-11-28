import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { Readable, Writable } from 'node:stream';
import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type SetSessionConfigOptionResponse,
} from '@agentclientprotocol/sdk';
import type { MachineModelTurnClaim, MachineModelTurnResult } from '@cairn/shared';
import { createCredentialProfile } from '@cairn/shared/credential-profile';
import {
  antigravityFileStorageEnv,
  prepareAntigravityHome,
  writeAntigravityAuthSettings,
  writeAntigravityOAuthCredential,
} from '../agent-config.js';
import { antigravityProbeEnv } from './antigravity-managed.js';

export async function runModelTurnProbe(
  install: { binPath: string; args: string[] },
  claim: MachineModelTurnClaim,
  appData: string,
  signal: AbortSignal,
  realHome = homedir(),
): Promise<MachineModelTurnResult> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
  let profile: ReturnType<typeof createCredentialProfile> | undefined;
  try {
    deadline.throwIfAborted();
    profile = createCredentialProfile(appData);
    const cwd = profile.home;
    const home =
      claim.mode === 'antigravity-host'
        ? prepareAntigravityHome({ cairnHome: cwd, realHome, apiKey: false })
        : cwd;
    if (claim.mode === 'antigravity-oauth') writeAntigravityOAuthCredential(home, claim.credential);
    if (claim.mode === 'antigravity-key') writeAntigravityAuthSettings(home);
    const child = spawn(install.binPath, install.args, {
      cwd,
      env: {
        ...antigravityProbeEnv(process.env),
        ...profile.env,
        HOME: home,
        ...(claim.mode === 'devin'
          ? { WINDSURF_API_KEY: claim.token }
          : antigravityFileStorageEnv(home)),
        ...(claim.mode === 'antigravity-key' ? { GEMINI_API_KEY: claim.token } : {}),
        TMPDIR: cwd,
        TEMP: cwd,
        TMP: cwd,
      },
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    });
    const app = client({ name: 'cairn' });
    let sessionId: string | undefined;
    let sawReply = false;
    let attemptedTool = false;
    app.onRequest(methods.client.session.requestPermission, () => {
      attemptedTool = true;
      return { outcome: { outcome: 'cancelled' } };
    });
    app.onNotification(methods.client.session.update, ({ params }) => {
      if (params.sessionId !== sessionId) return;
      const update = params.update;
      if (update.sessionUpdate === 'tool_call') attemptedTool = true;
      if (
        update.sessionUpdate === 'agent_message_chunk' &&
        update.content.type === 'text' &&
        update.content.text.trim() !== ''
      )
        sawReply = true;
    });
    const connection = app.connect(
      ndJsonStream(
        Writable.toWeb(child.stdin),
        Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      ),
    );
    const exited = new Promise<void>((resolve) =>
      child.once('close', () => {
        connection.close(new Error('Runner exited'));
        resolve();
      }),
    );
    child.on('error', (error) => connection.close(error));
    child.stdin.on('error', (error) => connection.close(error));
    const abort = () => connection.close(new Error('Model test timed out'));
    deadline.addEventListener('abort', abort, { once: true });
    try {
      const initialized = await connection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      });
      if (initialized.protocolVersion !== PROTOCOL_VERSION)
        return { status: 'failed', failure: 'upstream' };
      if (claim.mode === 'devin') {
        const auth =
          initialized.authMethods?.find((method) => /devin|key|token/i.test(method.id)) ??
          initialized.authMethods?.[0];
        if (auth)
          await connection.agent.request(methods.agent.authenticate, {
            methodId: auth.id,
            _meta: { api_key: claim.token },
          });
      }
      const session = await connection.agent.request(methods.agent.session.new, {
        cwd,
        mcpServers: [],
      });
      sessionId = session.sessionId;
      const option = session.configOptions?.find(
        (o) => o.category === 'model' && o.type === 'select',
      );
      if (!option || option.type !== 'select') return { status: 'failed', failure: 'upstream' };
      if (option.currentValue !== claim.model) {
        const selected = await connection.agent.request<SetSessionConfigOptionResponse>(
          methods.agent.session.setConfigOption,
          {
            sessionId,
            configId: option.id,
            value: claim.model,
          },
        );
        if (
          !selected.configOptions?.some(
            (o) => o.id === option.id && o.type === 'select' && o.currentValue === claim.model,
          )
        ) {
          return { status: 'failed', failure: 'not-found' };
        }
      }
      const turn = await connection.agent.request(methods.agent.session.prompt, {
        sessionId,
        prompt: [{ type: 'text', text: 'Reply only with OK. Do not use tools.' }],
      });
      return sawReply && !attemptedTool && turn.stopReason === 'end_turn'
        ? { status: 'ok' }
        : { status: 'failed', failure: 'upstream' };
    } finally {
      deadline.removeEventListener('abort', abort);
      connection.close();
      child.kill('SIGKILL');
      child.stdin.destroy();
      child.stdout.destroy();
      await exited;
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : '';
    return {
      status: 'failed',
      failure: deadline.aborted
        ? 'timeout'
        : /quota|rate limit|\b429\b/i.test(detail)
          ? 'rate-limit'
          : /login|unauthori[sz]ed|invalid credential|\b40[13]\b/i.test(detail)
            ? 'auth'
            : 'upstream',
    };
  } finally {
    profile?.cleanup();
  }
}
