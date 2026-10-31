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
`homeVisible: false`, and `negativeControl: "denied"`. Save the actual host
output to `docs/verify/2273/host-check.json` after installation. Local fixtures
are not host acceptance evidence. The check creates and cleans up a unique
`cairn-orb-check-*` container and refuses password prompts.

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
- Missing images, authorization denial, failed execution, failed cleanup, broken
  proxy egress, visible host homes, and incorrect limits cannot produce success.

Local Node tests use only built-ins, recorded command-output fixtures, a fake
polkit object, and stateful fake host commands. The owner must still verify
actual systemd, polkit, package installation, and proxy behavior on the host.

The host needs `socat`, `ip`, `nmcli`, systemd, and a Node executable available
through root's PATH or `ian`'s login shell. Host CLI pins come from `claude
--version` and `codex --version` in that login shell. Corepack installs the
repository's exact pnpm version. Existing networkd-managed host links or earlier network configuration files
stop the installer before changes.
A mismatched existing base image is preserved
and stops installation rather than being overwritten.

The proxy subnet is `10.203.0.0/24`, with the relay at `10.203.0.1:7890` on
`vz-cairn`. The subnet must be unused on the host. The container DHCP server
advertises no router or DNS server; proxy requests resolve names upstream.
NetworkManager ignores `ve-*`, `vz-*`, and nspawn's bridged `vb-*` slave links.
Networkd manages only `ve-*` and `vz-*`; nspawn attaches and raises its slaves.

Systemd does not expand instance-name prefixes when looking up drop-ins. A
shared start-preparation hook returns immediately for unrelated machines and
installs the trusted template under `/run/systemd/nspawn/<name>.nspawn` before
each matching start. It reads the requested limits drop-in and applies its
properties to that exact unit with `systemctl set-property --runtime`.
The polkit rule denies privileged bind and copy operations, including for
matching machines. Workspace transfer needs a separately scoped authorization
path; the existing real-smoke runner's bind operation is not authorized here.

The shared bridge allows communication between guests and with host services
listening on that bridge. Destination filtering, including denial of host or
LAN targets through the proxy, belongs to the existing proxy policy. The relay
limits children to 128 and tasks to 256. Per-machine runtime settings remain
under `/run` until reboot. Unrelated administrative actions retain their
existing authentication policy for named targets; unscoped machine-management
actions receive no grant. Image builds use an exclusive lock and preserve
staging trees with active or unreadable mounts.
