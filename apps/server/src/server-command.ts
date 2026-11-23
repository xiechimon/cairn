import { ENV_VARS, OWNER_LINK_MINT_PATH } from '@cairn/shared';
import { readOwnerToken, runTokenCommand } from '@cairn/shared/token-command';
import { openDbWithHandle } from './db/client.js';
import { ownerLinkLoopbackOrigin, ownerLinkMessage } from './lib/owner-link-url.js';
import { revokeOwnerBrowserSessions } from './services/browser-session.js';
import { revokeOwnerLinks } from './services/paired-devices.js';

export interface ServerCommandIo {
  env: NodeJS.ProcessEnv;
  writeOut(text: string): void;
  writeErr(text: string): void;
}

async function printFreshOwnerLink(io: ServerCommandIo): Promise<number> {
  const port = Number(io.env.PORT || 8787);
  const origin = ownerLinkLoopbackOrigin(io.env.HOST || '127.0.0.1', port);
  if (origin === null || !Number.isInteger(port) || port < 1 || port > 65535) {
    io.writeErr(
      'Use the `Open Cairn` link printed by the server, or run it on a loopback-reachable address and set PORT to its port.\n',
    );
    return 1;
  }
  const token = io.env[ENV_VARS.auth]?.toLowerCase() === 'off' ? null : readOwnerToken(io.env);
  if (token === null) {
    io.writeErr('No owner token is available. Start Cairn with token auth enabled first.\n');
    return 1;
  }
  try {
    const response = await fetch(`${origin}${OWNER_LINK_MINT_PATH}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    });
    if (response.status === 201) {
      const { code } = (await response.json()) as { code?: unknown };
      if (typeof code === 'string' && /^[a-zA-Z0-9_-]{43}$/.test(code)) {
        io.writeOut(ownerLinkMessage(origin, code));
        return 0;
      }
    }
  } catch {}
  io.writeErr(
    'Could not issue a sign-in link. Check that the server is running with the same CAIRN_HOME, access token and PORT.\n',
  );
  return 1;
}

export async function runServerCommand(
  args: readonly string[],
  io: ServerCommandIo,
): Promise<number | null> {
  const [command, ...rest] = args;
  if (command === undefined || command.startsWith('-')) return null;
  if (command === 'token') {
    const rotate = rest.includes('--rotate');
    if (rest.includes('--link')) {
      if (!rotate) return printFreshOwnerLink(io);
      io.writeErr('Use either --link or --rotate, not both.\n');
      return 1;
    }
    try {
      return runTokenCommand(
        {
          rotate,
          revokeOwnerBrowserAuth: (path) => {
            const { db, close } = openDbWithHandle(path);
            try {
              db.transaction((tx) => {
                revokeOwnerBrowserSessions(tx);
                revokeOwnerLinks(tx);
              });
            } finally {
              close();
            }
          },
        },
        io,
      );
    } catch {
      io.writeErr(
        'Could not rotate the access token or revoke owner browser sign-ins. Check CAIRN_HOME and its permissions.\n',
      );
      return 1;
    }
  }
  io.writeErr(
    `\`cairn ${command}\` is a Runner command from @xiechimon/cairn-cli. This \`cairn\` is the server, which takes no command except \`token\`; run it with no arguments to serve.\nTo run tasks on this computer, install the Runner CLI with \`npm i -g @xiechimon/cairn-cli\` and start the server with \`npx @xiechimon/cairn\`, since both packages install a \`cairn\` command.\n`,
  );
  return 1;
}
