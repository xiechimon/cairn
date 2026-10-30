#!/usr/bin/env bash
set -uo pipefail
umask 077
paths=()
pid=''
server_urls=()
tailscale_users=''
while [ $# -gt 0 ]; do
  case "$1" in
    --paths) shift; while [ $# -gt 0 ] && [[ "$1" != --* ]]; do paths+=("$1"); shift; done ;;
    --server-url) [ $# -ge 2 ] || exit 2; server_urls+=("$2"); shift 2 ;;
    --tailscale-users) [ $# -ge 2 ] || exit 2; tailscale_users="$2"; shift 2 ;;
    --pid) [ $# -ge 2 ] && [[ "$2" =~ ^[1-9][0-9]*$ ]] || exit 2; pid="$2"; shift 2 ;;
    *) exit 2 ;;
  esac
done
[ ${#paths[@]} -gt 0 ] || [ -n "$pid" ] || [ ${#server_urls[@]} -gt 0 ] || exit 2
tmp=$(mktemp -d) || exit 2
trap 'rm -rf "$tmp"' EXIT
result=0
probe() {
  local channel="$1" path="$2" tool="$3"
  shift 3
  if ! command -v "$tool" >/dev/null; then
    printf 'SKIPPED %s %s\n' "$channel" "$path"
  elif "$@" > "$tmp/output" 2>/dev/null; then
    printf 'READ %s %s %s bytes\n' "$channel" "$path" "$(wc -c < "$tmp/output" | tr -d ' ')"
    result=1
  else
    printf 'BLOCKED %s %s\n' "$channel" "$path"
  fi
}
for path in ${paths[@]+"${paths[@]}"}; do
  [[ "$path" = /* ]] || path="$PWD/$path"
  parent=$(dirname "$path")
  while [ ! -e "$parent" ] && [ "$parent" != / ]; do parent=$(dirname "$parent"); done
  if [ ! -e "$path" ] && [ -x "$parent" ]; then
    for channel in cat symlink python node subprocess dd cp; do printf 'MISSING %s %s\n' "$channel" "$path"; done
    result=1
    continue
  fi
  probe cat "$path" cat cat "$path"
  ln -s "$path" "$tmp/link" || exit 2
  probe symlink "$path" cat cat "$tmp/link"
  rm "$tmp/link"
  probe python "$path" python3 python3 -c 'import sys; sys.stdout.buffer.write(open(sys.argv[1],"rb").read())' "$path"
  probe node "$path" node node -e 'process.stdout.write(require("node:fs").readFileSync(process.argv[1]))' "$path"
  probe subprocess "$path" sh sh -c 'head -c1 "$1"' sh "$path"
  probe dd "$path" dd dd "if=$path" bs=1 count=1
  probe cp "$path" cp sh -c 'cp "$1" "$2" && cat "$2"' sh "$path" "$tmp/copy"
done
if [ -n "$pid" ]; then
  for channel in environ mem; do
    path="/proc/$pid/$channel"
    if [ "$(uname -s)" = Linux ]; then
      if [ "$channel" = mem ]; then
        if ! command -v node >/dev/null || ! node "$(dirname "$0")/process-memory.mjs" "$pid" > "$tmp/mem-status" 2>/dev/null; then
          printf 'SKIPPED mem %s\n' "$path"
        else
          status=$(cat "$tmp/mem-status")
          printf '%s mem %s\n' "$status" "$path"
          [ "$status" != READ ] || result=1
        fi
      else
        probe "$channel" "$path" dd dd "if=$path" bs=1 count=1
      fi
    else
      printf 'SKIPPED %s %s\n' "$channel" "$path"
    fi
  done
fi
if [ ${#server_urls[@]} -gt 0 ] && [ "$(uname -s)" = Linux ]; then
  if addresses=$(tailscale ip 2>/dev/null) && [ -n "$addresses" ]; then
    while IFS= read -r address; do
      [[ "$address" =~ ^[0-9a-fA-F:.]+$ ]] || { echo 'SKIPPED http invalid-Tailscale-address'; exit 2; }
      if [[ "$address" = *:* ]]; then server_urls+=("https://[$address]")
      else server_urls+=("https://$address"); fi
    done <<< "$addresses"
  else
    echo 'SKIPPED http Tailscale-address-discovery'
  fi
fi
for server_url in ${server_urls[@]+"${server_urls[@]}"}; do
  [[ "$server_url" =~ ^https?://([a-zA-Z0-9.-]+|\[[0-9a-fA-F:]+\])(:[0-9]+)?/?$ ]] || exit 2
  identities=(anonymous)
  IFS=',' read -r -a logins <<< "$tailscale_users"
  identities+=(${logins[@]+"${logins[@]}"})
  [ -n "$tailscale_users" ] || identities+=(secret-reach-probe)
  for login in "${identities[@]}"; do
    [ -n "$login" ] || continue
    headers=()
    [ "$login" = anonymous ] || headers=(-H "tailscale-user-login: $login")
    if ! command -v curl >/dev/null; then
      printf 'SKIPPED http %s %s\n' "$login" "$server_url"
    elif status=$(curl --insecure --noproxy '*' --max-time 10 -s -o /dev/null -w '%{http_code}' ${headers[@]+"${headers[@]}"} "${server_url%/}/api/teams"); then
      if [[ "$status" = 2[0-9][0-9] ]]; then
        printf 'READ http %s %s %s\n' "$login" "$status" "$server_url"
        result=1
      else
        printf 'BLOCKED http %s %s %s\n' "$login" "$status" "$server_url"
      fi
    else
      printf 'BLOCKED http %s transport %s\n' "$login" "$server_url"
    fi
  done
done
exit "$result"
