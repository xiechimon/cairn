import { type StreamTarget, webSocketTransport } from './sse-connection.js';

export interface StreamTicketReply {
  ticket?: string;
  transport?: string;
}

export function streamTargetOf(
  path: string,
  reply: StreamTicketReply | null,
): string | StreamTarget {
  if (reply === null) return path;
  const ticket = reply.ticket;
  if (ticket === undefined || ticket === '') return path;
  const url = `${path}?ticket=${encodeURIComponent(ticket)}`;
  if (reply.transport !== 'websocket') return url;
  return { url, transport: webSocketTransport };
}
