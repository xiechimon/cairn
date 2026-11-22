import { z } from 'zod';
import { recordId } from '../records/common.js';
import { CLOAK_LICENSE_SECRET, SECRET_NAME_PATTERN, SECRET_NAME_RULE } from '../records/secret.js';
import type { RemoteToolDef } from './chief-tools.js';

export const REQUEST_SECRET_TOOL = 'request_secret';
export const SECRET_REQUEST_SCOPES = ['team', 'project'] as const;
export const SECRET_REQUEST_DESCRIPTION_MAX_CHARS = 300;
export const SECRET_REQUEST_VALUE_MAX_CHARS = 4096;

const CONTROL_CHARACTER = /\p{Cc}/u;

export const REQUEST_SECRET_TOOL_DEF: RemoteToolDef = {
  name: REQUEST_SECRET_TOOL,
  description: `Post a secret card in the chat so the owner pastes a value only they have (an API key, a license, a token) straight into the Cairn secret store. You never see the value: the result says only whether it was saved. Use it instead of asking for the value in chat, putting it in set_secret, or sending the owner to settings. Waits until the owner saves or declines, then continue the work that needed it (for example retry the call that asked for it). A stealth browser call that says there is no CloakBrowser license needs ${CLOAK_LICENSE_SECRET} with scope team; when CloakBrowser rejected the saved key, say so in the description.`,
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Secret name, an env var name: capital letters, digits and _.',
      },
      scope: {
        type: 'string',
        description: `One of ${SECRET_REQUEST_SCOPES.join(', ')}. team: every project can use it. project: only the project in projectId.`,
      },
      projectId: { type: 'string', description: 'Project id; required when scope is project.' },
      description: {
        type: 'string',
        description: `What the secret is for and where the owner gets it, in the owner's language, at most ${SECRET_REQUEST_DESCRIPTION_MAX_CHARS} characters.`,
      },
    },
    required: ['name', 'scope', 'description'],
  },
};

export const secretRequestParamsSchema = z
  .strictObject({
    name: z.string().regex(SECRET_NAME_PATTERN, SECRET_NAME_RULE),
    scope: z.enum(SECRET_REQUEST_SCOPES),
    projectId: recordId.optional(),
    description: z.string().trim().min(1).max(SECRET_REQUEST_DESCRIPTION_MAX_CHARS),
  })
  .refine((params) => (params.scope === 'project') === (params.projectId !== undefined), {
    message: 'projectId is required for scope project and not allowed for scope team',
  });
export type SecretRequestParams = z.infer<typeof secretRequestParamsSchema>;

const secretRequestTarget = {
  name: z.string().regex(SECRET_NAME_PATTERN, SECRET_NAME_RULE),
  projectId: recordId.nullable(),
};

export const secretRequestAnswerSchema = z.discriminatedUnion('decision', [
  z.strictObject({
    decision: z.literal('save'),
    ...secretRequestTarget,
    value: z
      .string()
      .trim()
      .min(1, 'the value is empty')
      .max(
        SECRET_REQUEST_VALUE_MAX_CHARS,
        `the value is longer than ${SECRET_REQUEST_VALUE_MAX_CHARS} characters`,
      )
      .refine((value) => !CONTROL_CHARACTER.test(value), 'the value holds a control character'),
  }),
  z.strictObject({ decision: z.literal('cancel'), ...secretRequestTarget }),
]);
export type SecretRequestAnswer = z.infer<typeof secretRequestAnswerSchema>;

export const secretRequestAnsweredSchema = z.strictObject({ name: z.string() });
export type SecretRequestAnswered = z.infer<typeof secretRequestAnsweredSchema>;

export const SECRET_REQUEST_SAVED_PREFIX = 'The owner saved ';

export function secretRequestSaved(name: string, scope: 'team' | 'project'): string {
  return `${SECRET_REQUEST_SAVED_PREFIX}${name} as a ${scope} secret. Continue the work that needed it; you never see the value.`;
}

export const SECRET_REQUEST_CANCELLED =
  'The owner chose not to provide this secret. Tell the owner what stays blocked without it, and do not ask for it again unless they bring it up.';
export const SECRET_REQUEST_NOT_SAVED =
  'The owner did not provide the secret before the request ended. Stop and tell the owner what needs it.';
export const SECRET_REQUEST_REFUSED_PREFIX = 'request_secret refused before asking: ';
