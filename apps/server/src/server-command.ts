import { runTokenCommand } from '@cairn/shared/token-command';

export interface ServerCommandIo {
  env: NodeJS.ProcessEnv;
  writeOut(text: string): void;
  writeErr(text: string): void;
}

export function runServerCommand(args: readonly string[], io: ServerCommandIo): number | null {
  const [command, ...rest] = args;
  if (command === undefined || command.startsWith('-')) return null;
  if (command === 'token') return runTokenCommand({ rotate: rest.includes('--rotate') }, io);
  io.writeErr(
    `\`cairn ${command}\` is a Runner command from @xiechimon/cairn-cli. This \`cairn\` is the server, which takes no command except \`token\`; run it with no arguments to serve.\nTo run tasks on this computer, install the Runner CLI with \`npm i -g @xiechimon/cairn-cli\` and start the server with \`npx @xiechimon/cairn\`, since both packages install a \`cairn\` command.\n`,
  );
  return 1;
}
