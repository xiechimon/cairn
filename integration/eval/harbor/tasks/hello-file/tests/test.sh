#!/bin/sh
mkdir -p /logs/verifier
got=$(cat /app/hello.txt 2>/dev/null || true)
want=$(cat /tests/expected.txt)
if [ "$got" = "$want" ]; then
  printf '%s\n' 1 > /logs/verifier/reward.txt
else
  printf '%s\n' 0 > /logs/verifier/reward.txt
fi
