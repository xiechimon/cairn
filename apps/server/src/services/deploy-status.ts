import { readFileSync } from 'node:fs';
import { type DeployStatus, deployRecordSchema } from '@cairn/shared';

const NOT_DEPLOYED: DeployStatus = { deployed: null };

export function readDeployStatus(path: string | undefined): DeployStatus {
  if (path === undefined) return NOT_DEPLOYED;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return NOT_DEPLOYED;
  }
  const record = deployRecordSchema.safeParse(parsed);
  return record.success ? { deployed: record.data } : NOT_DEPLOYED;
}
