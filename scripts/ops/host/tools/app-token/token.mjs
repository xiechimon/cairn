import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { createAppAuth } from '@octokit/auth-app';

const config = JSON.parse(readFileSync(`${homedir()}/.cairn/cairn-bot.json`, 'utf8'));
const privateKey = readFileSync(config.privateKeyPath.replace(/^~/, homedir()), 'utf8');
const auth = createAppAuth({ appId: config.appId, privateKey });
const { token } = await auth({ type: 'installation', installationId: config.installationId });
process.stdout.write(token);
