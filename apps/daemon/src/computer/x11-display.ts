import { connect } from 'node:net';

export const X11_ANSWER_TIMEOUT_MS = 1_000;
export const X11_SOCKET_DIRECTORY = '/tmp/.X11-unix';

// X11 connection setup: byte order 'l', protocol 11.0, no authorization.
const SETUP_REQUEST = Buffer.from([0x6c, 0, 11, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const REPLY_SUCCESS = 1;
const REPLY_AUTHENTICATE = 2;

export function x11SocketPath(display: string): string {
  const [number] = display.replace(/^:/, '').split('.');
  return `${X11_SOCKET_DIRECTORY}/X${number}`;
}

// X clients reach a local display through the socket file or, when the server
// created no file, through the abstract socket of the same name.
export function x11SocketPaths(display: string): string[] {
  const path = x11SocketPath(display);
  return [path, `\0${path}`];
}

export function x11SocketAnswers(
  socketPath: string,
  timeoutMs: number = X11_ANSWER_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(socketPath);
    let settled = false;
    const settle = (answers: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(answers);
    };
    socket.setTimeout(timeoutMs, () => settle(false));
    socket.once('error', () => settle(false));
    socket.once('close', () => settle(false));
    socket.once('connect', () => socket.write(SETUP_REQUEST));
    socket.once('data', (chunk: Buffer) =>
      settle(chunk[0] === REPLY_SUCCESS || chunk[0] === REPLY_AUTHENTICATE),
    );
  });
}

export async function x11DisplayAnswers(
  display: string,
  timeoutMs: number = X11_ANSWER_TIMEOUT_MS,
): Promise<boolean> {
  for (const socketPath of x11SocketPaths(display)) {
    if (await x11SocketAnswers(socketPath, timeoutMs)) return true;
  }
  return false;
}
