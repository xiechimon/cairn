export const BROWSER_MCP_EXTENSION_PORT = 9009;

const SLOTS = 16;
const FIRST_DEBUG_PORT = 47811;
const FIRST_STREAM_PORT = 47831;

export const MAC_BROWSER_PORT_SLOTS = Array.from({ length: SLOTS }, (_, slot) => ({
  debug: FIRST_DEBUG_PORT + slot,
  stream: FIRST_STREAM_PORT + slot,
}));

export const MAC_SHELL_DENIED_PORTS: readonly number[] = [
  BROWSER_MCP_EXTENSION_PORT,
  ...MAC_BROWSER_PORT_SLOTS.flatMap(({ debug, stream }) => [debug, stream]),
];
