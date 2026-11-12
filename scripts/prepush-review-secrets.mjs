import { readFileSync } from 'node:fs';
import { redactSecrets } from '../packages/shared/src/secret-redaction.ts';

const files = JSON.parse(readFileSync(0, 'utf8'));
process.stdout.write(
  JSON.stringify(
    files.filter((file) => redactSecrets(file.text).count > 0).map((file) => file.path),
  ),
);
