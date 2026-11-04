#!/bin/bash
set -euo pipefail
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
env_dir="$root/tasks/offline-oracle/environment"
vendor="$env_dir/vendor"
mkdir -p "$vendor"
curl -fsSL -o "$vendor/uv.tar.gz" \
  https://github.com/astral-sh/uv/releases/download/0.9.7/uv-x86_64-unknown-linux-gnu.tar.gz
tar -xzf "$vendor/uv.tar.gz" -C "$vendor" --strip-components=1 uv-x86_64-unknown-linux-gnu/uv
mv "$vendor/uv" "$vendor/uv-0.9.7"
chmod 755 "$vendor/uv-0.9.7"
"$vendor/uv-0.9.7" pip install --python "$(command -v python3)" --target "$vendor/site" \
  pytest==8.4.1 pytest-json-ctrf==0.3.5
docker build --network=host \
  -t cairn-harbor-offline-oracle:1681 \
  "$env_dir"
