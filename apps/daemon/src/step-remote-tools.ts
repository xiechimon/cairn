import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { RemoteToolDef } from '@cairn/shared';
import { z } from 'zod';
import type { AskChannel } from './ask-channel.js';
import { prepareFileAttachment } from './attach-file.js';
import type { MachineApi } from './machine-client.js';

export interface VerifyEvidenceUploads {
  directory: string | undefined;
  uploaded: Set<string>;
}

export function stepRemoteToolExecutor(input: {
  client: Pick<MachineApi, 'relayTool'>;
  stepId: string;
  cwd: string;
  remoteTools: readonly RemoteToolDef[];
  askChannel: Pick<AskChannel, 'available' | 'ask'>;
  attachFiles: boolean;
  verifyEvidence: VerifyEvidenceUploads | null;
}): (name: string, params: Record<string, unknown>) => Promise<string> {
  const { client, stepId, cwd, remoteTools, askChannel, attachFiles, verifyEvidence } = input;
  return (name, params) => {
    if (name === 'ask_user' && askChannel.available) return askChannel.ask(params);
    if (name === 'attach_file' && attachFiles) {
      const prepared = prepareFileAttachment(cwd, params, verifyEvidence?.directory);
      const upload = client.relayTool(stepId, name, prepared);
      if (verifyEvidence === null) return upload;
      const path = resolve(cwd, String(params.path));
      const sha256 = createHash('sha256')
        .update(Buffer.from(String(prepared.contentBase64), 'base64'))
        .digest('hex');
      return upload.then((result) => {
        z.object({ id: z.string().min(1), sha256: z.literal(sha256) }).parse(JSON.parse(result));
        verifyEvidence.uploaded.add(path);
        return result;
      });
    }
    const def = remoteTools.find((t) => t.name === name);
    return client.relayTool(stepId, name, params, {
      ...(def?.replaySafe ? { replaySafe: true } : {}),
    });
  };
}
