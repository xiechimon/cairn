#!/bin/sh
for f in "$HOME/.cairn/machine.json" "$HOME/.cairn/github-oauth.env" "$HOME/.cairn/credentials.enc" "$HOME/.cairn/config.json"; do
  [ -e "$f" ] || { echo "MISSING $f"; continue; }
  if head -c 1 "$f" >/dev/null 2>&1; then echo "READ $(basename $f)"; else echo "BLOCKED $(basename $f)"; fi
done
