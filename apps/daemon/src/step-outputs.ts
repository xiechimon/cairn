import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  INFO_REPORT_MAX_BYTES,
  PLAN_FILE_NAME,
  REPORT_FILE_NAME,
  type VerifyVerdict,
} from '@cairn/shared';

export type InfoReportRead =
  | { kind: 'absent' }
  | { kind: 'report'; content: string }
  | { kind: 'too-large'; error: string };

export function readInfoReport(reportFile: string): InfoReportRead {
  if (!existsSync(reportFile)) return { kind: 'absent' };
  const content = readFileSync(reportFile, 'utf8');
  if (Buffer.byteLength(content, 'utf8') > INFO_REPORT_MAX_BYTES) {
    return {
      kind: 'too-large',
      error: `${REPORT_FILE_NAME} 超过上限 ${INFO_REPORT_MAX_BYTES} 字节，请压缩报告后重试`,
    };
  }
  return content.trim() === '' ? { kind: 'absent' } : { kind: 'report', content };
}

function nonBlankFile(path: string): string | null {
  if (!existsSync(path)) return null;
  const content = readFileSync(path, 'utf8');
  return content.trim() !== '' ? content : null;
}

export function readDeliveredPlan(plansDir: string, convId: string, cwd: string): string | null {
  const planPath = join(plansDir, convId, PLAN_FILE_NAME);
  return existsSync(planPath) ? nonBlankFile(planPath) : nonBlankFile(join(cwd, PLAN_FILE_NAME));
}

export function requireUploadedEvidence(
  verdict: VerifyVerdict,
  uploaded: ReadonlySet<string>,
  cwd: string,
): VerifyVerdict {
  if (!verdict.passed) return verdict;
  const evidence = verdict.evidence;
  if (evidence.length > 0 && evidence.every((item) => uploaded.has(resolve(cwd, item.path)))) {
    return verdict;
  }
  return {
    ...verdict,
    passed: false,
    conclusion: `${verdict.conclusion}\nAttachment evidence is missing or was not successfully uploaded by this verification step.`,
  };
}
