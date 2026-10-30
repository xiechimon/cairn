import { openDbWithHandle } from '../../apps/server/src/db/client.js';
import { seed } from '../../apps/server/src/db/seed.js';
import { createKeyfileSecretBox } from '../../apps/server/src/lib/secret-box.js';

const [dbPath, keyPath] = process.argv.slice(2);
const opened = openDbWithHandle(dbPath);
seed(opened.db);
opened.close();
console.log(createKeyfileSecretBox(keyPath).seal('fixture plaintext must stay private'));
