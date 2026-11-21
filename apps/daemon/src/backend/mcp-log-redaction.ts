import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type {
  McpServerConfig,
  McpServerEntry,
  McpTransportFactory,
} from '@earendil-works/pi-coding-agent';
import {
  type AuthProvider,
  isJsonRpcNotification,
  type JsonRpcMessage,
  type McpTransportMessageListener,
  StdioTransport,
  type StdioTransportOptions,
  StreamableHttpTransport,
  type StreamableHttpTransportOptions,
} from '@earendil-works/pi-mcp';
import { childEnv } from '../child-env.js';

export type McpLogRedactor = <T>(value: T) => T;

const SERVER_LOG_NOTIFICATION = 'notifications/message';
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ENV_NAME_PREFIX = /^[A-Za-z_][A-Za-z0-9_]*/;
const PURE_ENV_REFERENCE = /^(?:\$\{[A-Za-z_][A-Za-z0-9_]*\}|\$[A-Za-z_][A-Za-z0-9_]*)$/;

function expandHome(value: string): string {
  if (value === '~') return homedir();
  if (value.startsWith('~/') || (process.platform === 'win32' && value.startsWith('~\\')))
    return join(homedir(), value.slice(2));
  return value;
}

function envValue(name: string, template: string, description: string): string {
  const value = process.env[name];
  if (value === undefined || value === '')
    throw new Error(
      PURE_ENV_REFERENCE.test(template)
        ? `Failed to resolve ${description} from environment variable: ${name}`
        : `Failed to resolve ${description}: an environment variable in this value is not set`,
    );
  return value;
}

export function resolveMcpConfigValue(value: string, description: string): string {
  if (value.startsWith('!'))
    throw new Error(
      `Failed to resolve ${description}: the daemon does not run shell commands from MCP config values`,
    );
  let resolved = '';
  let index = 0;
  while (index < value.length) {
    const dollar = value.indexOf('$', index);
    if (dollar < 0) {
      resolved += value.slice(index);
      break;
    }
    resolved += value.slice(index, dollar);
    const next = value[dollar + 1];
    if (next === '$' || next === '!') {
      resolved += next;
      index = dollar + 2;
      continue;
    }
    if (next === '{') {
      const end = value.indexOf('}', dollar + 2);
      const name = end < 0 ? '' : value.slice(dollar + 2, end);
      if (end >= 0 && ENV_NAME.test(name)) {
        resolved += envValue(name, value, description);
        index = end + 1;
        continue;
      }
      if (end >= 0) {
        resolved += value.slice(dollar, end + 1);
        index = end + 1;
        continue;
      }
      resolved += '$';
      index = dollar + 1;
      continue;
    }
    const prefixed = ENV_NAME_PREFIX.exec(value.slice(dollar + 1));
    if (prefixed !== null) {
      resolved += envValue(prefixed[0], value, description);
      index = dollar + 1 + prefixed[0].length;
      continue;
    }
    resolved += '$';
    index = dollar + 1;
  }
  return resolved;
}

function resolvedValues(
  values: Record<string, string> | undefined,
  description: string,
): Record<string, string> | undefined {
  if (values === undefined) return undefined;
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    resolved[key] = resolveMcpConfigValue(value, `${description} "${key}"`);
  }
  return Object.keys(resolved).length > 0 ? resolved : undefined;
}

function stdioOptions(
  name: string,
  config: Extract<McpServerConfig, { command: string }>,
  cwd: string,
): StdioTransportOptions {
  return {
    command: expandHome(config.command),
    ...(config.args === undefined ? {} : { args: config.args.map(expandHome) }),
    cwd: resolve(cwd, expandHome(config.cwd ?? '.')),
    env: childEnv(resolvedValues(config.env, `MCP server "${name}" env`) ?? {}),
    inheritEnv: false,
    stderr: 'pipe',
  };
}

function httpOptions(
  name: string,
  config: Extract<McpServerConfig, { url: string }>,
  authProvider: AuthProvider | undefined,
): StreamableHttpTransportOptions {
  return {
    url: config.url,
    ...(config.headers === undefined
      ? {}
      : { headers: resolvedValues(config.headers, `MCP server "${name}" header`) }),
    ...(authProvider === undefined ? {} : { authProvider }),
  };
}

function redactedMessage(message: JsonRpcMessage, redact: McpLogRedactor): JsonRpcMessage {
  return isJsonRpcNotification(message) && message.method === SERVER_LOG_NOTIFICATION
    ? redact(message)
    : message;
}

function redactingListener(
  listener: McpTransportMessageListener,
  redact: McpLogRedactor,
): McpTransportMessageListener {
  return (message) => listener(redactedMessage(message, redact));
}

class RedactingStdioTransport extends StdioTransport {
  constructor(
    options: StdioTransportOptions,
    private readonly redact: McpLogRedactor,
  ) {
    super(options);
  }

  override onMessage(listener: McpTransportMessageListener): () => void {
    return super.onMessage(redactingListener(listener, this.redact));
  }
}

class RedactingHttpTransport extends StreamableHttpTransport {
  constructor(
    options: StreamableHttpTransportOptions,
    private readonly redact: McpLogRedactor,
  ) {
    super(options);
  }

  override onMessage(listener: McpTransportMessageListener): () => void {
    return super.onMessage(redactingListener(listener, this.redact));
  }
}

export function redactingMcpTransports(redact: McpLogRedactor): McpTransportFactory {
  return (entry: McpServerEntry, cwd: string, authProvider: AuthProvider | undefined) => {
    const { name, config } = entry;
    return 'url' in config
      ? new RedactingHttpTransport(httpOptions(name, config, authProvider), redact)
      : new RedactingStdioTransport(stdioOptions(name, config, cwd), redact);
  };
}
