#!/bin/sh
mkdir -p /logs/verifier
printf 'verifier-hostname='
hostname
printf 'verifier-routes\n'
cat /proc/net/route
if cmp -s /app/answer.txt /tests/expected.txt; then
  printf '%s\n' 1 > /logs/verifier/reward.txt
else
  printf '%s\n' 0 > /logs/verifier/reward.txt
fi
