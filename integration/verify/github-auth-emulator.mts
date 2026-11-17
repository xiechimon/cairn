import { runGithubAuthEmulatorCase } from '../test/github-auth-emulator-case.js';

const result = await runGithubAuthEmulatorCase();
console.log(
  JSON.stringify({
    provider: result.provider,
    login: result.saved?.login,
    repos: result.repos.length,
    requests: result.requests.length,
    evidence: process.env.VERIFY_EVIDENCE_DIR,
  }),
);
