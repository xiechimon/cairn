import type { LocalToolDef } from '@cairn/shared';
import type { StepCredentials } from './credentials.js';

export const GET_SECRET_TOOL_NAME = 'get_secret';

export interface SecretChannelOpts {
  creds: StepCredentials;
  stepId: string;
  agentId: string | null;
  onAudit: (line: string) => void;
  now?: () => Date;
}

export function secretAuditLine(opts: {
  stepId: string;
  agentId: string | null;
  name: string;
  at: Date;
}): string {
  return `secret taken step=${opts.stepId} agent=${opts.agentId ?? 'none'} name=${opts.name} at=${opts.at.toISOString()}`;
}

export function buildSecretTool(opts: SecretChannelOpts): LocalToolDef {
  return {
    name: GET_SECRET_TOOL_NAME,
    label: GET_SECRET_TOOL_NAME,
    description:
      'Read one team secret granted to you for this step. Secrets are not present in the ' +
      'shell environment: this tool is the only way to obtain the value. Every read is ' +
      'recorded (step, agent, secret name). Prefer piping the value into the command that ' +
      'needs it over writing it into files, logs or anything that leaves the machine.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Secret name, e.g. STRIPE_API_KEY.',
        },
      },
      required: ['name'],
    },
    execute: async (params: Record<string, unknown>): Promise<string> => {
      const name = typeof params.name === 'string' ? params.name : '';
      if (name === '') return 'get_secret needs a non-empty "name".';
      const value = opts.creds.secrets.take(name);
      if (value === null) {
        return opts.creds.secrets.names.length === 0
          ? `no team secret is available for this step (asked for "${name}"); this step's credential lifetime may have ended.`
          : `secret "${name}" is not granted to this agent for this step; granted: ${opts.creds.secrets.names.join(', ')}.`;
      }
      opts.onAudit(
        secretAuditLine({
          stepId: opts.stepId,
          agentId: opts.agentId,
          name,
          at: (opts.now ?? (() => new Date()))(),
        }),
      );
      return value;
    },
  };
}
