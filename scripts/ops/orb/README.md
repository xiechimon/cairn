# Orb host provisioning

Owner install command, from the repository checkout on the Linux host:

```sh
sudo bash scripts/ops/orb/install-host.sh
```

Preview every privileged step without changing the host:

```sh
bash scripts/ops/orb/install-host.sh --dry-run
```

Run the installer twice; the second successful run must print `0 changes`.
As `ian`, run the exact post-install check command:

```sh
scripts/ops/orb/orb-host-check.sh --json
```

A passing result exits zero and contains `image: "cairn-orb-base"`,
`cloneStartStop: "ok"`, `egress: "ok"`, `memoryMax: 4294967296`,
`homeVisible: false`, `negativeControl: "denied"`, `privateEgress: "denied"`,
and `firewall: "ok"`, with `ok: true` and an empty `errors` array. Save the actual
host output to `docs/verify/2273/host-check.json` after installation. Local fixtures
are not host acceptance evidence. The check creates and cleans up a unique
`cairn-orb-check-*` container and refuses password prompts.

Decision record: "transport decided by ian 2026-10-31 (option 1)".
The guest dials the host; the host never executes commands in a guest.

## Failure modes and local verification

- Missing or partial images, invalid CLI pins, and Node below 22.19 fail closed.
- Polkit evaluates both clone source and destination; other users, unnamed
  actions, unrelated units, and nonmatching names receive no grant.
- Resource limits, private users, proxy configuration, and host-path isolation
  must survive cloning and starting any `cairn-orb-*` instance.
- NetworkManager keeps physical interfaces; networkd only manages container
  links. The relay binds the container bridge only. No direct routing is enabled.
- Dry runs perform no mutations. Completed installs converge to zero changes;
  failed steps are never recorded as completed.
- Missing images, authorization denial, missing or malformed guest metadata, failed cleanup, broken
  proxy egress, visible host homes, and incorrect limits cannot produce success.

Local Node tests use only built-ins, recorded command-output fixtures, a fake
polkit object, and stateful fake host commands. The owner must still verify
actual systemd, polkit, package installation, and proxy behavior on the host.

The host needs `nft`, `ip`, `nmcli`, systemd, and a Node executable available
through root's PATH or `ian`'s login shell. The installer copies that executable
to `/usr/local/lib/cairn-orb/node` for the relay, so a home-based Node install
works with the user unit's `ProtectHome=yes`. Binary content and mode converge
on reruns. Host CLI pins come from `claude
--version` and `codex --version` in that login shell. Corepack installs the
repository's exact pnpm version. Existing networkd-managed host links or earlier network configuration files
stop the installer before changes.
A completed base image is rebuilt when the recipe or pinned host CLI versions
change. The previous base survives failed builds and is replaced only after
the staging image is complete and unmounted. Unrecognized images are preserved
and stop installation. The rebuild is printed and counted; the next run prints
`0 changes`. Existing clones keep their original tools.

The proxy subnet is `10.203.0.0/24`, with the relay at `10.203.0.1:7890` on
`vz-cairn`. The subnet must be unused on the host. The container DHCP server
advertises no router or DNS server. The relay resolves names locally, checks
every returned address, then sends `CONNECT <checked-ip>:<port>` to the upstream
proxy at `127.0.0.1:7890`. IPv6 authorities use brackets. This pins the actual
connection to the checked IP under the measured upstream configuration. HTTP
absolute URIs use that same tunnel with an origin-form request and the destination
Host header; HTTPS retains the client TLS handshake and SNI.
NetworkManager ignores `ve-*`, `vz-*`, and nspawn's bridged `vb-*` slave links.
Networkd manages only `ve-*` and `vz-*`; nspawn attaches and raises its slaves.

Systemd does not expand instance-name prefixes when looking up drop-ins. A
shared start-preparation hook clears fixed binds for unrelated machines and
installs the trusted template under `/run/systemd/nspawn/<name>.nspawn` before
each matching start. It reads the requested limits drop-in and applies its
properties to that exact unit with `systemctl set-property --runtime`.
The template drop-in passes three fixed binds using the systemd `%i` instance
specifier. The existing preparation hook writes the fixed bind arguments into a root-owned environment file only for
matching Orb machines. The active bind variable defaults to empty, so unrelated
machines receive no Orb binds:

| Host source | Guest target | Access |
| --- | --- | --- |
| `/run/cairn-orb/%i` | `/run/cairn` | writable, `idmap,norbind` |
| `/var/lib/cairn-orb/dist` | `/opt/cairn/daemon` | read-only, `idmap,norbind` |
| `/var/lib/cairn-orb/seed` | `/seed` | read-only, `idmap,norbind` |

The installer prints and installs `/etc/tmpfiles.d/cairn-orb.conf`, which
recreates `/run/cairn-orb` at boot. All three source directories are owned by
`ian`, mode `0700`. The host creates each machine's runtime directory with
mode `0700` before start; the preparation hook rejects symlinks, other owners and other
modes. It also requires the runtime filesystem to have `nosuid,nodev`.
`norbind` prevents nested mounts from propagating. `PrivateUsers=pick`
is retained, and the image pins `agent` to host `ian`'s numeric UID. Per
[systemd's idmap contract](https://www.freedesktop.org/software/systemd/man/latest/systemd-nspawn.html#--bind=),
that guest UID maps to the host UID only on these mounts. `cairn-runner` cannot
traverse the host directories. Another container has its own user namespace
and only its exact runtime directory mounted; the runtime parent and other
machines' sockets are absent. No network listener exposes the relay socket.
Actual filesystem idmap support and cross-user/container isolation must still
be checked on the Linux host after the owner's install; local fakes validate
the template arguments, ownership gates and directory modes, not kernel mounts.

Fill `dist` with the daemon package and its runtime dependencies, and put
Project seeds at `/var/lib/cairn-orb/seed/<projectId>/repo`, as `ian`. The image
uses one `daemon_entry` variable, `/opt/cairn/daemon/dist/cli.mjs`, matching
`apps/daemon/build.mjs` and the package binary entry. The enabled
`cairn-orb-worker.service` runs as `agent`, waits for `/run/cairn/relay.sock`,
and runs `orb-step --socket /run/cairn/relay.sock` with `Restart=always`.
The daemon relay protocol owns authentication, step binding, heartbeat, tool
and done messages; host crash fallback and the 120-second watchdog remain
on the host. This host/image change requires the daemon transport rework.

The polkit rule grants only scoped image clone/remove, unit start, and machine
kill/terminate. `machinectl poweroff` uses the machine `kill` authorization;
there is no separate `poweroff` verb grant. Listing needs no extra grant.
Shell, login, PTY, inspection, bind, copy, unregister, root-directory access,
unit stop/restart and unrelated operations receive no Orb grant.

The filtering relay uses Node built-ins and runs as the user unit, bound only
to the bridge IP and accepting only `10.203.0.0/24`. It refuses loopback, RFC1918,
link-local, CGNAT (including the tailnet), multicast, unspecified addresses,
IPv6 ULA and IPv4-mapped equivalents, including mixed public/private DNS
answers. Destination ports default to 80, 443 and 22 for both CONNECT and
absolute-URI HTTP. Other ports receive HTTP 403 before DNS resolution or upstream
contact. Override the comma-separated `CAIRN_ORB_ALLOWED_PORTS` through an
`egress-relay.service` environment drop-in; it replaces the defaults. Empty or
invalid port lists prevent startup. After changing the drop-in, reload the user
manager and restart the relay. It caps request and upstream response headers
at 16 KiB, idle time at 30 seconds, concurrent clients at 128 and unit tasks at 256.

The installer prints and installs its own `inet cairn_orb` nftables table.
Only container-subnet TCP/7890 to the bridge and DHCP client UDP/68 to server
UDP/67 reach host input; all other input and forwarding from `vz-cairn` drop.
DHCP replies originate on the host output path. The transaction flushes only
this owned table and recreates its rules, leaving existing host tables intact.
The enabled `cairn-orb-firewall.service` restores it before networkd at reboot;
networkd and nspawn require that service to succeed before starting. Guests
on the shared bridge can still communicate at layer 2.

The host check needs no sudo or nftables read access. It requires
`systemctl is-active cairn-orb-firewall.service` to report `active`. Inside the
throwaway container as `agent`, the baked `cairn-orb-check.service` uses `timeout 3 bash -c` with `/dev/tcp` to
connect directly to `10.203.0.1`, bypassing all proxy settings. TCP/7890 must
connect; TCP/22 and TCP/5231 must time out (exit 124). Set the comma-separated
`CAIRN_ORB_CHECK_BLOCKED_PORTS` environment variable to replace the blocked ports
with two to sixteen distinct ports, excluding 7890. Missing tools, incomplete
probes, an inactive service, reachable blocked ports, or an unreachable proxy
produce `firewall: "failed"` and `ok: false`. A refused connection does not count as a firewall drop. These probes sample
selected ports rather than proving every firewall rule. The guest proxy negative checks explicitly bypass NO_PROXY and
require HTTP 403 for both `127.0.0.1:80` and `10.203.0.1:22` (allowed ports, so the address filter refuses them); connectivity
errors cannot count as successful proxy filtering. Public egress has three
retries bounded by a 20-second retry window and a 30-second subprocess timeout.

Before start, the checker writes a request ID and blocked-port list to
`check-request` inside the new private runtime directory. The image's enabled
`cairn-orb-check.path` detects that file. The guest writes only exit statuses,
HTTP status codes, port numbers and request ID to an atomically published
`check-result.json`, then removes the trigger. No response bodies, headers,
stderr, credentials or tool output are returned. The host waits at most 150
polls, rejects symlinks, oversized/nonregular files, stale IDs and unexpected
fields, then powers off the clone. It polls machine listing for at most 30
attempts, requests terminate after 15, and removes the clone only once it is
absent. Failed shutdown/removal preserves the runtime directory for diagnosis.
No `systemd-run -M`, `--machine` guest transport, or `machinectl bind/shell/login`
is used. The template's `systemd-nspawn --machine=<name>` only names a new
container; the installer addresses the host user manager through `runuser`.

The `--json` result has `image` (base-image name or null), `cloneStartStop`
(`ok` or `failed`), `egress` (`ok` or `failed`), `privateEgress` (`denied` or
`failed`), `firewall` (`ok` or `failed`), `memoryMax` (bytes or null),
`homeVisible` (boolean or null), `negativeControl` (`denied` or `failed`),
`ok` (boolean), and `errors` (string array). Exit status is zero only when
`ok` is true. Configuration or user-validation errors return `ok: false` and
`errors` without the probe fields.

## Risk notes

The proxy path relies on sing-box not re-resolving checked IP destinations or
using fake-IP DNS, as measured on 2026-10-31. A later sing-box configuration
change, including sniff override or fake-IP, could reopen loopback access
through the upstream; the bridge firewall does not cover that proxy path.
The relay does not block the host's own public IPv4 address, so hairpin NAT to
router port forwards remains reachable on allowed destination ports.

Networkd has `Requires=cairn-orb-firewall.service` and starts after it. A failed
firewall unit keeps the container bridge down. Physical host networking remains
managed by NetworkManager and is unaffected.

The polkit transient-unit protection relies on the installed
`systemd-nspawn@.service` template existing: systemd must load that template
instead of allowing a caller to supply an arbitrary transient unit definition.
Residual privileges are scoped clone/remove, start, kill and terminate only.
Clones may use the base as a source; they cannot replace, remove or start it.
The fixed idmapped binds require kernel/filesystem support; unsupported mounts
fail startup instead of falling back to permissive modes. Image UID changes
require rebuilding the base and recreating existing clones. The build lock is
root-owned under `/run/lock/cairn-orb`, separate from private relay directories.

transport decided by ian 2026-10-31 (option 1). The independent Claude Opus 5.5
security review BLOCKed on a mount-source swap race: `ian` owns the runtime
parent and can replace a checked child with a symlink before nspawn resolves
it. Guest root also maps to host root within an `idmap` bind, so a malicious
owner process plus guest root could use that race for host privilege escalation.
The preparation hook's path checks do not eliminate this race. Changing the
parent to root ownership and creating children in the existing preparation
hook would prevent replacement, but differs from the decided owner-writable
parent contract and awaits ian's decision. Do not treat this rework as approved
for installation or merge while that finding remains unresolved.

Every guest can read all Project seeds under the explicitly decided shared
read-only `/seed` mount; this is not a boundary between Projects. The worker
unit sets `CAIRN_ORB=1`, but needs the separate daemon change that accepts
`orb-step --socket` and implements the authenticated relay client. Current
main's stdin/stdout worker cannot satisfy that interface.

Live Linux acceptance and an independent review of the resolved final patch
remain required before delivery of PR #2341. This local worktree run has no
sudo or host access.

Per-machine runtime settings remain
under `/run` until reboot. Unrelated administrative actions retain their
existing authentication policy for named targets; unscoped machine-management
actions receive no grant. Image builds use an exclusive lock and preserve
staging trees with active or unreadable mounts.
