# Isolate a Cairn execution machine

Use this guide before connecting a machine that processes issues, repositories, or MCP responses from people you do not trust. Read the [pre-launch findings](2000-prelaunch-review.md) before exposing a server. The reviewed checkout has unresolved registration and credential findings; the steps below reduce exposure and do not repair them.

## Choose the execution boundary

Run untrusted workloads on a disposable machine or a dedicated VM with its own OS account. Keep personal SSH keys, browser profiles, password stores, cloud credentials, and unrelated repositories off that machine. Give the executor only the repository and credentials needed for the current task.

For a separate user on an existing host, create a dedicated account with a private home, no sudo rights, and no access to other users' files. Do not add that user to Docker, administrator, or other host-control groups. Check shared directories and local services separately. A separate user limits filesystem access; it does not isolate the kernel or automatically restrict network access.

For a containerized executor, run as an unprivileged user. Mount only disposable workspace data. Keep root filesystems read-only where the backend permits it, drop capabilities, disable privilege escalation, and set resource limits. Do not mount the host home, SSH agent, Docker socket, host root, or daemon credential directory. Avoid privileged mode and host networking. Treat container escape and kernel exposure as residual risks.

The repository's `Dockerfile` packages the server and web UI. It does not by itself put a daemon running elsewhere, its shell, or its MCP child processes inside that container. Put the execution machine behind the chosen boundary independently. Container deployment and VM enforcement were not exercised in review #2000.

## Limit what the agent receives

Assume a shell-capable agent can read and modify every file available to its OS identity, execute child programs, install workspace dependencies, and contact every network destination reachable from that identity. A repository worktree determines where work starts; it does not confine access to that directory.

Assume tool responses, repository files, issue text, attachments, and MCP results can contain prompt injection. Human plan, review, and merge gates control workflow decisions. They do not intercept every filesystem write or network request. The Pi command gate catches selected command shapes, while Claude Code uses `bypassPermissions`; do not use those controls as a machine isolation guarantee.

Grant only the necessary team secrets, MCP tools, provider access, and repository permissions. Keep a human approval step for consequential operations. With the current `get_secret`, a granted secret is visible to the model and may persist in tool results or transcripts. Until #1775 ships an approved boundary, use disposable, revocable credentials and avoid high-value team secrets in untrusted tasks.

Run credential-holding services outside the untrusted execution identity where the deployment supports that separation. An unrestricted agent sharing the daemon's user can read daemon files and inherited environment data. Removing credentials from a prompt alone does not protect that arrangement. The current Pi runtime also runs in the daemon process; do not claim an external gateway boundary without restructuring and verification.

## Protect server access and local state

1. Bind a local server explicitly to `HOST=127.0.0.1`. Set a random `CAIRN_TOKEN` and `CAIRN_REQUIRE_TOKEN=1` before startup. Protect the token from shell history, logs, and shared environment files. Require-token mode also suppresses the token-bearing startup login link.
2. For remote access, use authenticated TLS and a firewall or private network with an explicit client allowlist. Keep the server unreachable by arbitrary clients while #2053 remains unresolved. The server bearer token currently does not protect enrollment confirmation.
3. Restrict every API key to trusted holders while #2054 is unresolved. A read-only MCP key currently also permits machine enrollment. Do not treat MCP tool grants as a complete limit on that key's authority.
4. Before starting the daemon under its dedicated user, set `umask 077`. Make its Cairn home private and keep `machine.json` readable only by its owner. Check existing files as well as newly created ones. #2056 tracks automatic permission enforcement.
5. Keep the server database and `secretbox.key` private. Back them up together into restricted storage. Anyone with both can decrypt stored secrets. Never mount those backups into the executor.
6. Use encrypted transport for remote daemon connections. Do not send machine tokens, API keys, or step credential bundles over untrusted plaintext HTTP. The default loopback URL is for local use.

When using Tailscale Serve, follow [the existing deployment guide](../deploy/tailscale-mobile.md). Trust identity headers only from the intended loopback proxy. Check that other local users cannot impersonate that proxy in your deployment.

## Restrict network and MCP access

Enforce outbound policy outside the agent's privileges. Cover direct sockets, IPv6, DNS, local relays, and cloud metadata endpoints. Do not rely on `HTTP_PROXY`, `HTTPS_PROXY`, or `NO_PROXY` as forced routing. A shell program can ignore them. Test the actual connections from the executor with synthetic credentials before granting real ones.

Approve MCP commands and remote endpoints individually. Treat a stdio MCP server as a program with the launch user's filesystem and network permissions. Keep credentials out of endpoint URLs and process arguments; use restricted credential configuration. Review remote endpoint redirects and credential handling before sending headers. Granting a tool also grants the external service's allowed actions, even when no secret value appears in the model output.

## Verify and retire the environment

Before assigning an untrusted task, use disposable sentinels to check that the executor cannot read host credentials, traverse other users' homes, contact prohibited destinations, or access a host-control socket. Verify that unauthenticated clients cannot register machines and that a restricted key cannot acquire executor authority after the corresponding fixes land. Record results per OS and backend; a Linux result does not establish macOS isolation.

After a task, stop its processes, remove disposable workspace data, revoke temporary credentials, and review unexpected machine registrations and secret reads. After suspected compromise, revoke the machine and API credentials server-side and rotate any exposed team or provider credentials. Deleting a local file or clearing an in-memory reference does not revoke copied credentials or erase uploaded transcripts. Restrict access to historical transcripts, logs, session files, and backups that may contain secrets.
