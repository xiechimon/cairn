#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd -- "$script_dir/../../.." && pwd)
context=${CAIRN_ORB_IMAGE_CONTEXT:-$repo_root/apps/daemon/orb-image}
lock_file=${CAIRN_HEAVY_LOCK:-/tmp/cairn-heavy.lock}
user_uid=1000

if [[ $# != 0 ]]; then printf 'Usage: build-container-image.sh\n' >&2; exit 2; fi
if [[ $(id -u) == 0 ]]; then printf 'Run build-container-image.sh as an unprivileged user; the Orb image is built rootless\n' >&2; exit 1; fi
[[ -f $context/Dockerfile && -f $context/entry.sh ]] || { printf 'Missing Dockerfile or entry.sh in %s\n' "$context" >&2; exit 1; }

host_version() {
  bash -lc "$1 --version"
}
claude_version=${CAIRN_ORB_CLAUDE_VERSION:-$(host_version claude | awk 'NR == 1 {print $1}')}
codex_version=${CAIRN_ORB_CODEX_VERSION:-$(host_version codex | awk 'NR == 1 {print $NF}')}
[[ $claude_version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && $codex_version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { printf 'Cannot pin Claude Code and Codex versions\n' >&2; exit 1; }
pnpm_version=$(cat "$script_dir/pnpm.version")
[[ $pnpm_version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { printf 'Cannot pin pnpm from %s/pnpm.version\n' "$script_dir" >&2; exit 1; }
node_major=${CAIRN_ORB_NODE_MAJOR:-$(sed -E 's/^v?([0-9]+).*/\1/' "$repo_root/.nvmrc")}
[[ $node_major =~ ^[1-9][0-9]*$ && $node_major -ge 22 ]] || { printf 'Cannot pin the Node major; set CAIRN_ORB_NODE_MAJOR\n' >&2; exit 1; }

recipe=$({
  printf 'Dockerfile\n'
  cat "$context/Dockerfile"
  printf '\nentry.sh\n'
  cat "$context/entry.sh"
  printf '\npins\nnode_major=%s\nclaude=%s\ncodex=%s\npnpm=%s\nagent_uid=%s\n' "$node_major" "$claude_version" "$codex_version" "$pnpm_version" "$user_uid"
} | sha256sum | cut -c1-16)
tag=cairn-orb-base:$recipe

if podman image exists "$tag"; then
  printf 'image %s already exists; skipping build\n' "$tag" >&2
  printf '%s\n' "$tag"
  exit 0
fi

exec 9>>"$lock_file"
printf 'waiting for the heavy-work lock %s\n' "$lock_file" >&2
flock 9
if podman image exists "$tag"; then
  printf 'image %s was built while waiting for the lock; skipping build\n' "$tag" >&2
  printf '%s\n' "$tag"
  exit 0
fi

printf 'building %s (Node %s, Claude Code %s, Codex %s, pnpm %s)\n' "$tag" "$node_major" "$claude_version" "$codex_version" "$pnpm_version" >&2
podman build \
  --http-proxy=false \
  --target base \
  --build-arg "NODE_MAJOR=$node_major" \
  --build-arg "CLAUDE_VERSION=$claude_version" \
  --build-arg "CODEX_VERSION=$codex_version" \
  --build-arg "PNPM_VERSION=$pnpm_version" \
  --build-arg "USER_UID=$user_uid" \
  --build-arg "RECIPE_HASH=$recipe" \
  -t "$tag" \
  "$context" >&2 9>&-
printf '%s\n' "$tag"
