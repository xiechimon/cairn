#!/usr/bin/env bash
set -euo pipefail

dry_run=false
if [[ "${1:-}" == --dry-run ]]; then dry_run=true; shift; fi
[[ $# == 1 ]] || { printf 'Usage: prepare-machine.sh [--dry-run] MACHINE\n' >&2; exit 2; }
name=$1
[[ $name != cairn-orb-* || $name =~ ^cairn-orb-[a-zA-Z0-9][a-zA-Z0-9-]*$ ]] || { printf 'Invalid machine name\n' >&2; exit 2; }
changes=0
host_root=${CAIRN_ORB_ROOT:-}
bind_file=$host_root/run/systemd/nspawn/$name.binds
if [[ $name != cairn-orb-* ]]; then
  expected='CAIRN_ORB_BINDS='
else
  [[ $name != cairn-orb-base ]] || exit 2
  directory=$host_root/run/cairn-orb/$name
  [[ -d $directory && ! -L $directory && $(stat -c '%U:%a' "$directory") == ian:700 ]] || { printf 'Expected private runtime directory owned by ian\n' >&2; exit 1; }
  mount_options=$(findmnt --noheadings --output OPTIONS --target "$directory")
  [[ ,$mount_options, == *,nosuid,* && ,$mount_options, == *,nodev,* ]] || { printf 'Runtime filesystem requires nosuid,nodev\n' >&2; exit 1; }
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
