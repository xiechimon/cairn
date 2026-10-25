# Security policy

## Supported versions

Cairn is pre-1.0. Only the latest published release of each package gets security fixes:

| Package | Supported |
|---|---|
| [`@xiechimon/cairn`](https://www.npmjs.com/package/@xiechimon/cairn) (server and web UI) | latest |
| [`@xiechimon/cairn-cli`](https://www.npmjs.com/package/@xiechimon/cairn-cli) (machine daemon) | latest |

## Reporting a vulnerability

Do not open a public issue, pull request or discussion for a security problem.

Report it privately through GitHub: open the repository's [Security tab](https://github.com/xiechimon/cairn/security) and choose **Report a vulnerability**. Include:

- the affected package and version, or the commit SHA;
- what an attacker can do, and what access they need first;
- steps or a proof of concept that reproduce it.

You will get an acknowledgement within 7 days. Once the issue is confirmed, a fix and an advisory are prepared together, and you are credited in the advisory unless you ask not to be.

## Scope

Cairn runs AI agents that execute code on machines you register. By design an agent step can run shell commands, use the git and GitHub credentials given to it, and read the team secrets it is allowed to fetch. Reports are most useful when they cross a boundary Cairn claims to enforce, for example:

- reaching `/api/*` without `CAIRN_TOKEN` when it is set, or with a revoked API key;
- one team reading or changing another team's data, secrets or machines;
- a webhook or issue intake importing work from a user below triage permission;
- a merge landing without the human gates (plan and diff approval, AI review verdict) it was configured to pass;
- secrets leaving encrypted storage other than through a recorded, permitted fetch.

An agent doing something harmful with permissions you granted it is a configuration matter, not a vulnerability. Run the server on a trusted network, set `CAIRN_TOKEN` whenever it listens beyond localhost, and terminate TLS in front of it.
