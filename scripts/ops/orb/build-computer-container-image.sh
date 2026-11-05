#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd -- "$script_dir/../../.." && pwd)
context=${CAIRN_COMPUTER_IMAGE_CONTEXT:-$repo_root/apps/daemon/computer-container-image}
base=${CAIRN_COMPUTER_BASE_IMAGE:-}

if [[ $# != 0 ]]; then printf 'Usage: build-computer-container-image.sh\n' >&2; exit 2; fi
if [[ $(id -u) == 0 ]]; then printf 'Build the computer image as an unprivileged user\n' >&2; exit 1; fi
[[ $base =~ ^(localhost/)?cairn-orb-base:[a-f0-9]{16}$ ]] || { printf 'CAIRN_COMPUTER_BASE_IMAGE must name an existing pinned cairn-orb-base:<recipe> image\n' >&2; exit 1; }
[[ $context == /* ]] || { printf 'Computer image context must be absolute\n' >&2; exit 1; }
for file in Dockerfile entry.sh desktop.sh chromium-policy.json; do
  [[ -f $context/$file ]] || { printf 'Missing computer image file: %s\n' "$context/$file" >&2; exit 1; }
done

[[ $(podman info --format '{{.Host.Security.Rootless}}') == true ]] || { printf 'The computer image requires a rootless runtime\n' >&2; exit 1; }
base_id=$(podman image inspect --format '{{.Id}}' "$base") || { printf 'Build the pinned base image separately before building the computer image\n' >&2; exit 1; }
[[ $base_id =~ ^[a-f0-9]{64}$ ]] || { printf 'The base image did not resolve to an immutable image ID\n' >&2; exit 1; }
recipe=$({
  printf 'base=%s\n' "$base_id"
  for file in Dockerfile entry.sh desktop.sh chromium-policy.json; do
    printf '\n%s\n' "$file"
    cat "$context/$file"
  done
} | sha256sum | cut -c1-16)
tag=cairn-orb-computer:$recipe

if podman image exists "$tag"; then
  printf '%s\n' "$tag"
  exit 0
else
  result=$?
  if ((result != 1)); then exit "$result"; fi
fi

podman build \
  --pull=never \
  --http-proxy=false \
  --build-arg "COMPUTER_BASE_IMAGE=$base_id" \
  --build-arg "RECIPE_HASH=$recipe" \
  --tag "$tag" \
  "$context" >&2
printf '%s\n' "$tag"
