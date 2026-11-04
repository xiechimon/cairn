import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function checkSmoke(file, now = Date.now()) {
  try {
    const record = JSON.parse(readFileSync(file, 'utf8'));
    const age = now - Date.parse(record.at);
    return record.ok === true &&
      typeof record.model === 'string' &&
      record.model.trim() !== '' &&
      Number.isFinite(age) &&
      age >= 0 &&
      age <= 24 * 60 * 60 * 1000
      ? 'complete'
      : 'incomplete';
  } catch {
    return 'incomplete';
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const status = checkSmoke(
    process.argv[2] ?? join(process.env.CAIRN_HOME ?? join(homedir(), '.cairn'), 'smoke.json'),
    process.argv[3] === undefined ? Date.now() : Date.parse(process.argv[3]),
  );
  console.log(status);
  process.exitCode = status === 'complete' ? 0 : 1;
}
