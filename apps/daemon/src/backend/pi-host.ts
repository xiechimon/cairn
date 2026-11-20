import type { DeliveredImage, LocalToolDef, SessionOpts } from '@cairn/shared';
import { credentialRedactor } from '../credential-output.js';
import { setupProxy } from '../proxy.js';
import { PiBackend, type PiSessionHandle } from './pi.js';
import {
  FrameWriter,
  type ParentFrame,
  type PiHostLogChannel,
  PiHostProtocolError,
  parentFrameSchema,
  parseFrame,
  readFrames,
} from './pi-host-protocol.js';

interface PendingTool {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
}

export async function runPiHost(): Promise<void> {
  const writeFrame = process.stdout.write.bind(process.stdout) as (
    chunk: string,
    callback?: () => void,
  ) => boolean;
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) =>
    (process.stderr.write as (...args: unknown[]) => boolean)(
      chunk,
      ...rest,
    )) as typeof process.stdout.write;
  const exit = async (code: number): Promise<never> => {
    await new Promise<void>((resolve) => writeFrame('', () => resolve()));
    process.exit(code);
  };
  const writer = new FrameWriter(process.stdout, writeFrame, () => {
    process.exit(1);
  });
  setupProxy({ raw: () => {} }, process.env);

  const tools = new Map<string, PendingTool>();
  let toolCounter = 0;
  let handle: PiSessionHandle | null = null;
  let initialized = false;
  let stopRequested = false;
  let redact = credentialRedactor();

  const request = (
    kind: 'remote' | 'local',
    name: string,
    params: Record<string, unknown>,
  ): Promise<string> => {
    const id = `t${toolCounter++}`;
    return new Promise<string>((resolve, reject) => {
      tools.set(id, { resolve, reject });
      writer.send({ t: 'tool_request', id, kind, name, params });
    });
  };

  const stopSession = async (): Promise<void> => {
    stopRequested = true;
    if (handle !== null) await handle.stop();
  };

  const pump = async (session: PiSessionHandle): Promise<void> => {
    for await (const event of session.events) {
      writer.send({ t: 'event', event });
      if (event.type === 'message_end' || event.type === 'done')
        writer.send({ t: 'usage', usage: [...session.usage()] });
    }
    writer.send({ t: 'usage', usage: [...session.usage()] });
    await session.settled();
    writer.send({ t: 'ended' });
    await exit(0);
  };

  const start = async (frame: Extract<ParentFrame, { t: 'initialize' }>): Promise<void> => {
    const secrets = frame.session.secrets ?? [];
    redact = credentialRedactor(frame.session.provider.apiKey, ...secrets);
    const log = (channel: PiHostLogChannel) => (message: string) =>
      writer.send({ t: 'log', channel, message });
    const backend = new PiBackend({
      agentDir: frame.agentDir,
      sessionDir: frame.sessionDir,
      ...(frame.skills !== undefined ? { skills: frame.skills } : {}),
      ...(frame.machineName !== undefined ? { machineName: frame.machineName } : {}),
      onMcpLog: log('mcp'),
      onSkillsLog: log('skills'),
      onGateLog: log('gate'),
      onTrustLog: log('trust'),
      onOtelLog: log('otel'),
      onCompactionLog: log('compaction'),
    });
    const localTools: LocalToolDef[] = (frame.session.localTools ?? []).map((definition) => ({
      ...definition,
      execute: (params) => request('local', definition.name, params),
    }));
    const remoteTools = frame.session.remoteTools ?? [];
    const opts = {
      ...frame.session,
      secrets: () => secrets,
      localTools,
      ...(remoteTools.length > 0
        ? {
            executeRemoteTool: (name: string, params: Record<string, unknown>) =>
              request('remote', name, params),
          }
        : {}),
    } as SessionOpts;
    const session = await backend.openInProcess(opts, frame.resumeFile);
    handle = session;
    writer.send({
      t: 'ready',
      v: frame.v,
      sessionId: session.sessionId,
      ...(session.sessionFile !== undefined ? { sessionFile: session.sessionFile } : {}),
    });
    if (stopRequested) await session.stop();
    await pump(session);
  };

  const fatal = async (error: unknown): Promise<never> => {
    const message = error instanceof Error ? error.message : String(error);
    writer.send({ t: 'fatal', message: redact(message) });
    return exit(1);
  };

  const handle_ = (frame: ParentFrame): void => {
    switch (frame.t) {
      case 'initialize':
        if (initialized) throw new PiHostProtocolError('pi host initialized twice');
        initialized = true;
        void start(frame).catch(fatal);
        return;
      case 'steer': {
        if (handle === null) throw new PiHostProtocolError('pi host steered before ready');
        const images: DeliveredImage[] | undefined = frame.images;
        const sent =
          images !== undefined ? handle.steer(frame.text, images) : handle.steer(frame.text);
        void sent.then(
          () => writer.send({ t: 'steer_reply', id: frame.id, ok: true }),
          (error: unknown) =>
            writer.send({
              t: 'steer_reply',
              id: frame.id,
              ok: false,
              error: redact(error instanceof Error ? error.message : String(error)),
            }),
        );
        return;
      }
      case 'tool_reply': {
        const pending = tools.get(frame.id);
        if (pending === undefined)
          throw new PiHostProtocolError('pi host got an unknown tool reply');
        tools.delete(frame.id);
        if (frame.ok) pending.resolve(frame.text ?? '');
        else pending.reject(new Error(frame.error ?? 'tool failed'));
        return;
      }
      case 'stop':
        void stopSession().catch(fatal);
        return;
    }
  };

  process.on('uncaughtException', (error) => void fatal(error));
  process.on('unhandledRejection', (error) => void fatal(error));

  readFrames(
    process.stdin,
    (line) => {
      const frame = parseFrame(line, parentFrameSchema);
      if (!initialized && frame.t !== 'initialize')
        throw new PiHostProtocolError('pi host got a frame before initialize');
      handle_(frame);
    },
    (error) => {
      for (const pending of tools.values()) pending.reject(new Error('parent closed the pipe'));
      tools.clear();
      if (error !== null) {
        void fatal(error);
        return;
      }
      void stopSession()
        .catch(() => {})
        .finally(() => process.exit(1));
    },
  );
}
