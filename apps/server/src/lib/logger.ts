import { redactSecrets } from '@cairn/shared';
import pino, { type DestinationStream, type LoggerOptions } from 'pino';

export function createServerLogger(
  secrets: readonly string[],
  options: LoggerOptions,
  destination?: DestinationStream,
): pino.Logger {
  return pino(
    {
      ...options,
      hooks: {
        streamWrite: (line) =>
          `${JSON.stringify(redactSecrets(JSON.parse(line), secrets).value)}\n`,
      },
    },
    destination,
  );
}
