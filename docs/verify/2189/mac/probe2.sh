#!/bin/sh
d=$(mktemp -d "${TMPDIR:-/tmp}/probe.XXXX") || { echo "NO_TMP"; exit 2; }
echo "tmp=$d"
ln -s "$HOME/.cairn/cairnwright.private-key.pem" "$d/l" && echo "link created"
if head -c 5 "$d/l" >/dev/null 2>&1; then echo "READ symlink"; else echo "BLOCKED symlink"; fi
cp "$HOME/.cairn/server/secretbox.key" "$d/c" 2>/dev/null; if [ -s "$d/c" ]; then echo "READ cp"; else echo "BLOCKED cp"; fi
if dd if="$HOME/.cairn/server/secretbox.key" of=/dev/null count=1 2>/dev/null; then echo "READ dd"; else echo "BLOCKED dd"; fi
if node -e "require('fs').readFileSync(process.env.HOME+'/.cairn/server/secretbox.key')" 2>/dev/null; then echo "READ node"; else echo "BLOCKED node"; fi
git diff --no-index --stat /dev/null "$HOME/.cairn/cairnwright.private-key.pem" >/dev/null 2>&1; rc=$?; if [ $rc -le 1 ] && [ -n "$(git diff --no-index --numstat /dev/null "$HOME/.cairn/cairnwright.private-key.pem" 2>/dev/null)" ]; then echo "READ git-no-index"; else echo "BLOCKED git-no-index rc=$rc"; fi
