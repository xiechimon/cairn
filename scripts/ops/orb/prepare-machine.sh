#!/usr/bin/env bash
set -euo pipefail

dry_run=false
if [[ "${1:-}" == --dry-run ]]; then dry_run=true; shift; fi
stop=false
if [[ "${1:-}" == --stop ]]; then stop=true; shift; fi
[[ $# == 1 ]] || { printf 'Usage: prepare-machine.sh [--dry-run] [--stop] MACHINE\n' >&2; exit 2; }
name=$1
[[ $name != cairn-orb-* || $name =~ ^cairn-orb-[a-zA-Z0-9][a-zA-Z0-9-]*$ ]] || { printf 'Invalid machine name\n' >&2; exit 2; }
changes=0
host_root=${CAIRN_ORB_ROOT:-}
bind_file=$host_root/run/systemd/nspawn/$name.binds
if $stop && [[ $name != cairn-orb-* ]]; then exit 0; fi
if [[ $name != cairn-orb-* ]]; then
  expected='CAIRN_ORB_BINDS='
else
  [[ $name != cairn-orb-base ]] || exit 2
  if ! $stop; then
    [[ $(sysctl -n fs.protected_hardlinks) == 1 ]] || { printf 'Runtime idmap requires fs.protected_hardlinks=1\n' >&2; exit 1; }
    mount_options=$(findmnt --noheadings --output OPTIONS --target "$host_root/run/cairn-orb")
    [[ ,$mount_options, == *,nosuid,* && ,$mount_options, == *,nodev,* ]] || { printf 'Runtime filesystem requires nosuid,nodev\n' >&2; exit 1; }
  fi
  runtime_args=("$name")
  if $stop; then runtime_args=(--stop "${runtime_args[@]}"); fi
  if $dry_run; then runtime_args=(--dry-run "${runtime_args[@]}"); fi
  if ! $dry_run; then install -d -m 755 "$host_root/run/systemd/nspawn"; fi
  runtime_changes=$("${CAIRN_ORB_NODE:-/usr/local/lib/cairn-orb/node}" "$(dirname -- "${BASH_SOURCE[0]}")/runtime-directory.mjs" "${runtime_args[@]}")
  [[ $runtime_changes =~ ^[01]' changes'$ ]] || { printf 'Invalid runtime preparation result\n' >&2; exit 1; }
  changes=${runtime_changes%% *}
  if $stop; then printf '%s changes\n' "$changes"; exit 0; fi
  expected="CAIRN_ORB_BINDS=${CAIRN_ORB_FIXED_BINDS:?Missing fixed bind configuration}"
fi
if [[ ! -f $bind_file || $(cat "$bind_file") != "$expected" ]]; then
  printf 'install %s mode 644\n' "$bind_file"
  if ! $dry_run; then
    install -d -m 755 "$host_root/run/systemd/nspawn"
    printf '%s\n' "$expected" > "$bind_file"
    chmod 644 "$bind_file"
  fi
  changes=$((changes + 1))
fi
if [[ $name != cairn-orb-* ]]; then printf '%s changes\n' "$changes"; exit 0; fi
source_file=$host_root/etc/systemd/nspawn/cairn-orb.nspawn
target_file=$host_root/run/systemd/nspawn/$name.nspawn
persistent=$host_root/etc/systemd/nspawn/$name.nspawn
if [[ -e $persistent ]] && ! cmp -s "$source_file" "$persistent"; then
  printf 'Conflicting persistent configuration: %s\n' "$persistent" >&2
  exit 1
fi
if ! cmp -s "$source_file" "$target_file"; then
  printf 'install %s as %s\n' "$source_file" "$target_file"
  if ! $dry_run; then install -D -m 644 "$source_file" "$target_file"; fi
  changes=$((changes + 1))
fi
unit=systemd-nspawn@$name.service
current=$(systemctl show "$unit" -p MemoryMax -p CPUQuotaPerSecUSec -p TasksMax)
if ! { printf '%s\n' "$current" | grep -qx 'MemoryMax=4294967296' &&
       printf '%s\n' "$current" | grep -qx 'CPUQuotaPerSecUSec=4s' &&
       printf '%s\n' "$current" | grep -qx 'TasksMax=4096'; }; then
  properties=()
  while IFS='=' read -r key value; do
    case "$key" in MemoryMax|CPUQuota|TasksMax) properties+=("$key=$value");; esac
  done < "$host_root/etc/systemd/system/systemd-nspawn@cairn-orb-.service.d/limits.conf"
  [[ ${#properties[@]} == 3 ]] || { printf 'Invalid limits configuration\n' >&2; exit 1; }
  printf 'systemctl set-property --runtime %s %s\n' "$unit" "${properties[*]}"
  if ! $dry_run; then systemctl set-property --runtime "$unit" "${properties[@]}"; fi
  changes=$((changes + 1))
fi
printf '%s changes\n' "$changes"
