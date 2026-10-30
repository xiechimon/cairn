#!/bin/sh
d=$(mktemp -d /tmp/b0/sbx/probe.XXXX)
ln -s /tmp/b0/sbx/secret/canary.key "$d/l"
for ch in symlink cp dd; do
  case $ch in
    symlink) out=$(cat "$d/l" 2>&1) ;;
    cp) cp /tmp/b0/sbx/secret/canary.key "$d/c" 2>/dev/null; out=$(cat "$d/c" 2>&1) ;;
    dd) out=$(dd if=/tmp/b0/sbx/secret/canary.key 2>/dev/null) ;;
  esac
  case $out in CANARY*) echo "READ $ch ${#out}B";; *) echo "BLOCKED $ch";; esac
done
