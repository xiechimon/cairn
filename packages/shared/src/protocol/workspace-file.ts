import { z } from 'zod';

export const WORKSPACE_FILE_LIMIT = 256 * 1024;
export const WORKSPACE_FILE_CWD = ':step-workspace';

const namedFiles = new Set(['Dockerfile', 'Gemfile', 'LICENSE', 'Makefile', 'README', 'Rakefile']);
const segment = /^[\p{L}\p{M}\p{N}_-][\p{L}\p{M}\p{N}_.-]*$/u;
const windowsDevice = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i;
const privateName =
  /^(?:id_(?:rsa|ecdsa|ed25519|dsa)(?:\.|$)|(?:credentials?|secrets?)(?:\.|$)|.*\.(?:key|p12|pfx|pem)$)/i;

function isWorkspaceFilePath(value: string): boolean {
  const parts = value.split('/');
  const name = parts.at(-1) ?? '';
  return (
    parts.every(
      (part) =>
        segment.test(part) &&
        !part.endsWith('.') &&
        !windowsDevice.test(part) &&
        !privateName.test(part),
    ) &&
    (parts.length > 1 || /\.[a-z0-9]{1,16}$/i.test(name) || namedFiles.has(name))
  );
}

export const workspaceFilePathSchema = z.string().min(1).max(1024).refine(isWorkspaceFilePath);
export const workspaceFileInstanceSchema = z
  .string()
  .min(32)
  .max(8192)
  .regex(/^[A-Za-z0-9_-]+$/);

export function workspaceFileReferences(
  text: string,
): { path: string; start: number; end: number }[] {
  const references: { path: string; start: number; end: number }[] = [];
  for (const match of text.matchAll(/[\p{L}\p{M}\p{N}_./%:#?=@\\~+-]+/gu)) {
    const raw = match[0].replace(/\.+$/, '');
    const path = raw.replace(/\\([_./-])/g, '$1');
    if (path.length <= 1024 && isWorkspaceFilePath(path)) {
      references.push({ path, start: match.index, end: match.index + raw.length });
    }
  }
  return references;
}

export const workspaceFileReadEventSchema = z.strictObject({
  type: z.literal('workspace.file.read'),
  requestId: z.uuid(),
  path: workspaceFilePathSchema,
  workspace: workspaceFileInstanceSchema,
});
export type WorkspaceFileReadEvent = z.infer<typeof workspaceFileReadEventSchema>;

function containsBinaryControls(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    if ((unit < 32 && unit !== 9 && unit !== 10 && unit !== 13) || (unit >= 127 && unit <= 159)) {
      return true;
    }
  }
  return false;
}

export const workspaceFileResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('ok'),
    text: z
      .string()
      .max(WORKSPACE_FILE_LIMIT)
      .refine(
        (text) =>
          new TextEncoder().encode(text).byteLength <= WORKSPACE_FILE_LIMIT &&
          !containsBinaryControls(text),
      ),
  }),
  z.strictObject({ status: z.enum(['gone', 'unsupported', 'unavailable']) }),
]);
export type WorkspaceFileResult = z.infer<typeof workspaceFileResultSchema>;

export const machineWorkspaceFileReplySchema = z.strictObject({
  connectionId: z.string().min(1).max(64),
  result: workspaceFileResultSchema,
});
export type MachineWorkspaceFileReply = z.infer<typeof machineWorkspaceFileReplySchema>;
