#!/bin/sh
set -eu
mkdir -p /logs/verifier
printf '0\n' > /logs/verifier/reward.txt
rm -f /logs/verifier/reward.json
cd /app
workspace=/logs/artifacts/workspace
if [ -d "$workspace" ]; then
  find "$workspace" \( -name node_modules -o -name .git \) -prune -exec rm -rf {} +
  (cd "$workspace" && find . ! -type d | sed 's|^\./||' | grep -E -f /tests/protected-regex.txt | grep -vxF -f /tests/solution-paths.txt || true) | while IFS= read -r path; do rm -f -- "$workspace/$path"; done
  cp -a "$workspace"/. /app/
fi
git apply /tests/tests.patch
node --test scripts/single-use-helper-gate.test.mjs > /logs/verifier/test-output.txt 2>&1
printf '1\n' > /logs/verifier/reward.txt
