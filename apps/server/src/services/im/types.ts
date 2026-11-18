import type { ImPlatform } from '@cairn/shared';

export interface ImSocketHandlers {
  onOpen?(): void;
  onMessage(text: string): void;
  onClose(code: number, reason: string): void;
  onError?(): void;
}

export interface ImSocket {
  send(text: string): void;
  close(): void;
}

export interface ImEnv {
  fetch: typeof fetch;
  now(): number;
  sleep(ms: number): Promise<void>;
  connectSocket(url: string, handlers: ImSocketHandlers): ImSocket;
}

export interface ImInboundMessage {
  chat: { key: string; kind: 'direct' | 'group'; title: string | null };
  sender: { id: string; name: string | null };
  text: string;
  images: unknown[];
  messageId: string;
  mentioned: boolean;
}

export interface ImOutboundMessage {
  chatKey: string;
  text: string;
  replyToMessageId?: string;
  buttons?: { label: string; value: string }[][];
}

export interface ImConnectionHandlers {
  onMessage(msg: ImInboundMessage): void;
  onStatus(
    status: 'connecting' | 'ready' | 'degraded' | 'expired' | 'error',
    detail?: string,
  ): void;
}

export interface ImAdapter {
  platform: ImPlatform;
  check(
    fields: Record<string, string>,
  ): Promise<{ ok: true; accountLabel: string } | { ok: false; reason: string }>;
  connect(
    fields: Record<string, string>,
    handlers: ImConnectionHandlers,
    env: ImEnv,
  ): Promise<{ send(msg: ImOutboundMessage): Promise<void>; stop(): Promise<void> }>;
  loginStart?(env: ImEnv): Promise<{ loginId: string; qr?: string; expiresAt: number }>;
  loginWait?(
    loginId: string,
    env: ImEnv,
  ): Promise<
    { status: 'pending' | 'expired' } | { status: 'done'; fields: Record<string, string> }
  >;
}
