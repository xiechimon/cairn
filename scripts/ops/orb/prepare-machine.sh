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
  [[ $name != cairn-orb-base && $name != cairn-orb-computer ]] || exit 2
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
  if [[ $name == cairn-orb-computer-* ]]; then
    home_options=$(findmnt --noheadings --output OPTIONS --target "$host_root/var/lib/cairn-computer")
    [[ ,$home_options, == *,nosuid,* && ,$home_options, == *,nodev,* ]] || { printf 'Computer homes require a nosuid,nodev mount at /var/lib/cairn-computer\n' >&2; exit 1; }
    home_args=("$name")
    if $dry_run; then home_args=(--dry-run "${home_args[@]}"); fi
    home_changes=$("${CAIRN_ORB_NODE:-/usr/local/lib/cairn-orb/node}" "$(dirname -- "${BASH_SOURCE[0]}")/computer-home.mjs" "${home_args[@]}")
    [[ $home_changes =~ ^[01]' changes'$ ]] || { printf 'Invalid computer home preparation result\n' >&2; exit 1; }
    changes=$((changes + ${home_changes%% *}))
    computer_dir=$host_root/run/cairn-orb/$name/computer
    if [[ ! -d $computer_dir ]]; then
      printf 'install %s mode 700\n' "$computer_dir"
      if ! $dry_run; then
        ian_uid=$(id -u ian)
        ian_gid=$(id -g ian)
        install -d -o "$ian_uid" -g "$ian_gid" -m 700 "$computer_dir"
      fi
      changes=$((changes + 1))
    fi
    expected="$expected --bind=/var/lib/cairn-computer/$name:/home/agent:idmap,norbind --bind=/run/cairn-orb/$name/computer:/run/cairn-computer:idmap,norbind"
  fi
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
if ! $dry_run; then
  if ! systemctl set-property --runtime "$unit" MemoryAccounting=true; then
    printf 'set-property failed for %s\n' "$unit" >&2
    exit 1
  fi
fi
printf '%s changes\n' "$changes"
