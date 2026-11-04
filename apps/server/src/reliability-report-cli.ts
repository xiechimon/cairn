import { parseArgs } from 'node:util';
import { loadConfig } from './config.js';
import {
  buildReliabilityReport,
  buildReplayReport,
  openReliabilityReportDb,
  readReplayFile,
  renderReliabilityMarkdown,
} from './reliability-report.js';

class UsageError extends Error {}

try {
  const { values } = parseArgs({
    options: {
      project: { type: 'string' },
      replay: { type: 'string' },
      repo: { type: 'string' },
      base: { type: 'string' },
      since: { type: 'string' },
      until: { type: 'string' },
    },
  });
  const replayPath = values.replay;
  if (replayPath !== undefined && replayPath !== '') {
    if (values.repo === undefined || values.repo === '') {
      throw new UsageError('--repo <owner/name> is required with --replay');
    }
    if (values.base === undefined || values.base === '') {
      throw new UsageError('--base <sha> is required with --replay');
    }
    if (
      values.since === undefined ||
      values.since === '' ||
      values.until === undefined ||
      values.until === ''
    ) {
      throw new UsageError('--since <ISO> and --until <ISO> are required');
    }
    const since = Date.parse(values.since);
    const until = Date.parse(values.until);
    if (!Number.isFinite(since) || !Number.isFinite(until)) {
      throw new UsageError('--since and --until must be ISO timestamps');
    }
    if (since > until) {
      throw new UsageError('--since must not be after --until');
    }
    const entries = readReplayFile(replayPath, {
      repo: values.repo,
      baseSha: values.base,
      since,
      until,
    });
    const report = buildReplayReport(entries, { repo: values.repo, since, until });
    console.log(JSON.stringify(report, null, 2));
    console.log('---');
    console.log(renderReliabilityMarkdown(report));
  } else {
    if (values.project === undefined || values.project === '') {
      throw new UsageError('--project <id> is required');
    }
    if (
      values.since === undefined ||
      values.since === '' ||
      values.until === undefined ||
      values.until === ''
    ) {
      throw new UsageError('--since <ISO> and --until <ISO> are required');
    }
    const since = Date.parse(values.since);
    const until = Date.parse(values.until);
    if (!Number.isFinite(since) || !Number.isFinite(until)) {
      throw new UsageError('--since and --until must be ISO timestamps');
    }
    if (since > until) {
      throw new UsageError('--since must not be after --until');
    }
    const { db, close } = openReliabilityReportDb(loadConfig().dbPath);
    try {
      const report = buildReliabilityReport(db, { projectId: values.project, since, until });
      console.log(JSON.stringify(report, null, 2));
      console.log('---');
      console.log(renderReliabilityMarkdown(report));
    } finally {
      close();
    }
  }
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`Reliability report failed: ${reason}`);
  process.exitCode = error instanceof UsageError ? 2 : 1;
}
