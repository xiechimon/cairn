# Orb host acceptance (#2273)

`host-check.json` is the output of `scripts/ops/orb/orb-host-check.sh --json`, run on omarchy as the unprivileged owner (no sudo) on 2026-10-31 from a clean checkout at 56114ab9d, after the owner ran `sudo env CAIRN_ORB_NODE_MAJOR=26 bash scripts/ops/orb/install-host.sh` twice (the second run printed `0 changes`). Exit status 0, `ok: true`, no errors.

It covers: the base image is registered; a throwaway `cairn-orb-check-*` machine is cloned, started, stopped and removed through polkit without a password; the guest reaches the network through the filtering relay and gets a lease on the container bridge; private and loopback targets are refused; the firewall drops other bridge ports; ufw carries the two scoped cairn-orb rules; `MemoryMax` is 4 GiB; the owner's home is not visible in the guest; and polkit refuses a machine name outside the `cairn-orb-` prefix.

`daemonRelease` is null because the host daemon had not yet published a release when the check ran; it is informational.
