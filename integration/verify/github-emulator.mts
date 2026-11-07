import { runGithubEmulatorCase } from '../test/github-emulator-case.js';

const result = await runGithubEmulatorCase();
console.log(JSON.stringify({ provider: result.provider, checks: result.open.checksTotal, state: result.merged.state, requests: result.requests.length, evidence: process.env.VERIFY_EVIDENCE_DIR }));
