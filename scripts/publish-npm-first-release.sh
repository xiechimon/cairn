#!/usr/bin/env bash

set -euo pipefail

if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]]; then
  BOLD=$(tput bold); DIM=$(tput dim); RESET=$(tput sgr0)
  BLUE=$(tput setaf 4); GREEN=$(tput setaf 2); YELLOW=$(tput setaf 3); RED=$(tput setaf 1)
else
  BOLD=""; DIM=""; RESET=""; BLUE=""; GREEN=""; YELLOW=""; RED=""
fi

TOTAL_STAGES=0

_STAGE_INDEX=0
ENV_FILE="${ENV_FILE:-.env}"
WRITTEN_ENV=()
WRITTEN_SECRET=()
SKIPPED=()

_clear() {
  [[ -t 1 ]] || return 0
  if command -v tput >/dev/null 2>&1; then tput clear; else printf '\033[2J\033[3J\033[H'; fi
}

banner() {
  _clear
  printf '\n%s%s  %s%s\n' "$BOLD" "$BLUE" "$1" "$RESET"
  printf '%s  %s stages%s\n\n' "$DIM" "$TOTAL_STAGES" "$RESET"
  printf '%s  You drive the browser; this wizard tells you exactly what to do and\n' "$DIM"
  printf '  captures the values you copy back. Stop any time with Ctrl-C and re-run\n'
  printf '  from the start: nothing is persisted, so the token is re-collected.%s\n' "$RESET"
  pause "Ready to start?"
}

stage() {
  _clear
  _STAGE_INDEX=$((_STAGE_INDEX + 1))
  printf '\n%s%s▸ Stage %s/%s · %s%s\n' \
    "$BOLD" "$BLUE" "$_STAGE_INDEX" "$TOTAL_STAGES" "$1" "$RESET"
}

say()  { printf '  %s\n' "$1"; }
step() { printf '  %s•%s %s\n' "$BLUE" "$RESET" "$1"; }
note() { printf '  %s%s%s\n' "$DIM" "$1" "$RESET"; }
warn() { printf '  %s⚠ %s%s\n' "$YELLOW" "$1" "$RESET"; }

open_url() {
  local url="$1"
  printf '  %s↗ opening%s %s\n' "$GREEN" "$RESET" "$url"
  { if   command -v wslview     >/dev/null 2>&1; then wslview "$url"
    elif command -v explorer.exe >/dev/null 2>&1; then explorer.exe "$url"
    elif command -v xdg-open    >/dev/null 2>&1; then xdg-open "$url"
    elif command -v open        >/dev/null 2>&1; then open "$url"
    else warn "couldn't open a browser; visit it manually: $url"; fi
  } >/dev/null 2>&1 || warn "couldn't open a browser, so visit it manually: $url"
}

pause() {
  printf '  %s%s%s ' "$DIM" "${1:-Press Enter to continue}" "$RESET"
  read -r _ || true
}

confirm() {
  local reply=""
  printf '  %s? %s [y/N] ' "$YELLOW" "$1"
  read -r reply || true
  [[ "$reply" =~ ^[Yy] ]]
}

_existing() {
  [[ -f "$ENV_FILE" ]] || return 1
  local line; line=$(grep -E "^${1}=" "$ENV_FILE" | tail -n1) || return 1
  printf '%s' "${line#*=}"
}

ask() {
  local key="$1" prompt="$2" current input
  current=$(_existing "$key" || true)
  if [[ -n "$current" ]]; then
    printf '  %s%s%s %s[Enter keeps current]%s ' "$BOLD" "$prompt" "$RESET" "$DIM" "$RESET"
  else
    printf '  %s%s%s ' "$BOLD" "$prompt" "$RESET"
  fi
  read -r input || true
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

ask_secret() {
  local key="$1" prompt="$2" current input
  current=$(_existing "$key" || true)
  if [[ -n "$current" ]]; then
    printf '  %s%s%s %s[Enter keeps current]%s ' "$BOLD" "$prompt" "$RESET" "$DIM" "$RESET"
  else
    printf '  %s%s%s ' "$BOLD" "$prompt" "$RESET"
  fi
  read -rs input || true
  printf '\n'
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

write_env() {
  local key="$1" value="$2" tmp
  touch "$ENV_FILE"
  tmp=$(mktemp)
  grep -vE "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
  WRITTEN_ENV+=("$key")
  printf '  %s✓ wrote%s %s → %s\n' "$GREEN" "$RESET" "$key" "$ENV_FILE"
}

set_secret() {
  local name="$1" value="$2"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    if printf '%s' "$value" | gh secret set "$name" >/dev/null 2>&1; then
      WRITTEN_SECRET+=("$name")
      printf '  %s✓ set%s GitHub secret %s\n' "$GREEN" "$RESET" "$name"
      return
    fi
  fi
  SKIPPED+=("GitHub secret $name (set it manually: gh secret set $name)")
  warn "skipped GitHub secret $name: gh not ready; set it later"
}

set_var() {
  local name="$1" value="$2"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    if gh variable set "$name" --body "$value" >/dev/null 2>&1; then
      printf '  %s✓ set%s GitHub variable %s\n' "$GREEN" "$RESET" "$name"
      return
    fi
  fi
  SKIPPED+=("GitHub variable $name")
  warn "skipped GitHub variable $name, gh not ready; set it later"
}

finish() {
  _clear
  printf '\n%s%s  ✓ Setup complete%s\n' "$BOLD" "$GREEN" "$RESET"
  (( ${#WRITTEN_ENV[@]} ))    && note "wrote ${#WRITTEN_ENV[@]} value(s) to $ENV_FILE: ${WRITTEN_ENV[*]}"
  (( ${#WRITTEN_SECRET[@]} )) && note "set ${#WRITTEN_SECRET[@]} GitHub secret(s): ${WRITTEN_SECRET[*]}"
  if (( ${#SKIPPED[@]} )); then
    printf '\n'; warn "still to do by hand:"
    for s in "${SKIPPED[@]}"; do note "  - $s"; done
  fi
  printf '\n'
}

TOTAL_STAGES=6

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO_ROOT"

banner "cairn · npm first release 0.1.0 (@xiechimon two packages)"

stage "npm account check"
say "Confirm the publisher's npm login state. The wizard only runs read-only commands (npm whoami) and never logs in for you."
command -v npm >/dev/null 2>&1 || { warn "npm is not on PATH — install Node 22/24 LTS, then re-run this wizard"; exit 1; }
NPM_USERNAME=""
LOGIN_TRIES=0
while [[ -z "$NPM_USERNAME" ]]; do
  NPM_USERNAME=$(npm whoami 2>/dev/null </dev/null || true)
  if [[ -z "$NPM_USERNAME" ]]; then
    (( LOGIN_TRIES >= 5 )) && { warn "5 consecutive login failures — exiting; log in, then re-run this wizard."; exit 1; }
    LOGIN_TRIES=$((LOGIN_TRIES + 1))
    warn "This environment is not logged in to npm (npm whoami returned nothing)."
    say "Run npm login in a separate terminal (finish the browser login), then come back here."
    pause "Press Enter once logged in; I will re-check"
  fi
done
printf '  %s✓ signed in as: %s%s\n' "$GREEN" "$NPM_USERNAME" "$RESET"
open_url "https://www.npmjs.com/~${NPM_USERNAME}"
note "Confirm the avatar and username are right — both packages will live under this account's scope."
note "This wizard persists nothing: after Ctrl-C, re-running starts from scratch (the token must be pasted again)."

stage "2FA status"
say "npm's current rule: to publish you need either account 2FA enabled or a bypass token — this wizard uses the former."
open_url "https://www.npmjs.com/settings/${NPM_USERNAME}/tfa"
step "If the direct link 404s, use the menu: avatar (top right) → Account → Two-Factor Authentication."
step "Already enabled: just seeing the bound authenticator / security key finishes this stage."
step "Not enabled: Enable 2FA → enter account password → pick an authenticator (TOTP) or a security key."
warn "Store the recovery codes in a password manager: logging in with one triggers a 72-hour"
warn "freeze on publishing and token creation — hitting that on launch day is a hard stop."
step "An authenticator (TOTP) is smoother than a bare security key: publish's OTP prompt wants a 6-digit code."
pause "Press Enter once you have confirmed the 2FA status on the page"
PROFILE_2FA=$(npm profile get </dev/null 2>/dev/null | grep -i "two-factor" || true)
if [[ -n "$PROFILE_2FA" && "$PROFILE_2FA" != *"none"* ]]; then
  printf '  %s✓ npm profile get: %s%s\n' "$GREEN" "$PROFILE_2FA" "$RESET"
else
  warn "npm profile get did not read an enabled 2FA (or the command is unavailable) — trust what the page shows."
fi
confirm "Is account 2FA enabled?" || warn "Without 2FA you cannot publish via this procedure; enable it, then re-run this wizard"

stage "granular access token (env only, nothing on disk)"
say "Create a launch-only granular token: scope it as tightly as possible to @xiechimon with a short expiry."
open_url "https://www.npmjs.com/settings/${NPM_USERNAME}/tokens/granular-access-tokens/new"
step "If the direct link fails, use the menu: avatar → Access Tokens → Generate New Token (if a type"
step "choice appears, pick Granular — classic tokens were removed in 2025-11, so this is the only kind left)."
step "Token name: cairn-first-publish-0.1.0."
step "Packages and scopes → Permissions: Read and write (publish and stage)."
step "Select Packages → first try Only select packages and scopes, and search @xiechimon."
say "Before the first release the scope has no packages yet, so the picker usually cannot find it — the fallback (same advice as the official docs):"
say "pick All Packages + cap the expiry at 7 days, delete the token right after the first release, and mint a narrower one when needed."
step "Bypass two-factor authentication: leave it unchecked — account 2FA is on, so at publish time"
step "you enter the OTP interactively; bypass will be removed by npm in 2027-01, so do not bet the launch on it."
step "Expiration: 7 days (the launch window; bounds the leak surface)."
step "Generate Token → copy the token from the top of the page (it is shown once; closing the page loses it forever)."
NPM_PUBLISH_TOKEN=""
TOKEN_TRIES=0
while :; do
  printf '  %spaste the token (starts with npm_): %s ' "$BOLD" "$RESET"
  read -rs NPM_PUBLISH_TOKEN || true
  printf '\n'
  if [[ "$NPM_PUBLISH_TOKEN" == npm_* && ${#NPM_PUBLISH_TOKEN} -gt 20 ]]; then
    break
  fi
  (( TOKEN_TRIES >= 5 )) && { warn "5 consecutive bad pastes — giving up on token capture; the publish section will not print commands."; NPM_PUBLISH_TOKEN=""; break; }
  TOKEN_TRIES=$((TOKEN_TRIES + 1))
  warn "Does not look like a granular token (npm_ prefix + a long string); paste it again."
done
TOKEN_WHOAMI=$(npm whoami --//registry.npmjs.org/:_authToken="$NPM_PUBLISH_TOKEN" </dev/null 2>/dev/null || true)
if [[ "$TOKEN_WHOAMI" == "$NPM_USERNAME" ]]; then
  printf '  %s✓ token identity verified (whoami = %s)%s\n' "$GREEN" "$NPM_USERNAME" "$RESET"
else
  warn "The token failed whoami — a granular token may lack access to the identity endpoint, so it is not necessarily invalid;"
  warn "the real check happens at publish time. If publish reports E401, first suspect a mis-copied or expired token."
fi
note "The token lives only in this wizard's process and your terminal env: nothing was written to .env or .npmrc,"
note "and nothing entered the shell history. Re-running the wizard means pasting (or minting) it again."

stage "launch execution (main package first, cli package after; the publish commands run in your terminal)"
say "Run the pre-flight checks first (read-only): package shape, registry state, worktree cleanliness."
PKG_DIRS=( "apps/server" "apps/daemon" )
PKG_NAMES=( "@xiechimon/cairn" "@xiechimon/cairn-cli" )
PKG_HINTS=( "#261 main-package reshape" "#262 cli rename" )
PUBLISH_READY=1
TO_PUBLISH=()
if [[ -n "$(git status --porcelain 2>/dev/null || true)" ]]; then
  warn "The worktree is dirty — npm publish packs the on-disk files, so uncommitted changes would ship in the package."
  say "Commit or stash before publishing (the wizard only warns; it does not handle it for you)."
fi
for i in 0 1; do
  dir="${PKG_DIRS[$i]}" name="${PKG_NAMES[$i]}" hint="${PKG_HINTS[$i]}" mf="$dir/package.json"
  if [[ ! -f "$mf" ]]; then
    warn "$mf does not exist (is $hint not landed yet?)"; PUBLISH_READY=0; continue
  fi
  actual=$(node -p "JSON.parse(require('fs').readFileSync('$mf','utf8')).name" 2>/dev/null || true)
  if [[ "$actual" != "$name" ]]; then
    warn "$dir package name is still \"${actual:-(unreadable)}\", expected $name — $hint has not landed."
    PUBLISH_READY=0
  fi
  is_private=$(node -p "JSON.parse(require('fs').readFileSync('$mf','utf8')).private === true" 2>/dev/null || true)
  if [[ "$is_private" == "true" ]]; then
    warn "$dir is still private: true — npm will refuse to publish."; PUBLISH_READY=0
  fi
  version=$(node -p "JSON.parse(require('fs').readFileSync('$mf','utf8')).version || 'unset'" 2>/dev/null || true)
  if [[ "$version" != "0.1.0" ]]; then
    warn "$dir version is ${version:-(unreadable)}, the launch number is 0.1.0 — confirm before continuing."
  fi
  access=$(node -p "(JSON.parse(require('fs').readFileSync('$mf','utf8')).publishConfig || {}).access || ''" 2>/dev/null || true)
  if [[ "$access" != "public" ]]; then
    warn "$dir lacks publishConfig.access=public — the command will carry --access public as a fallback."
  fi
  ws_deps=$(node -p "Object.entries(JSON.parse(require('fs').readFileSync('$mf','utf8')).dependencies || {}).filter(([,v]) => /workspace:|catalog:/.test(String(v))).map(([k,v]) => k+'@'+v).join(', ')" 2>/dev/null || true)
  if [[ -n "$ws_deps" ]]; then
    warn "$dir dependencies still carry workspace:/catalog: references ($ws_deps) —"
    warn "npm publish would land them verbatim in the manifest and the package would not install. The $hint is not done."
    PUBLISH_READY=0
  fi
  files_field=$(node -p "JSON.stringify(JSON.parse(require('fs').readFileSync('$mf','utf8')).files || null)" 2>/dev/null || true)
  if [[ "$files_field" == "null" ]]; then
    warn "$dir has no files field — the whole directory gets packed by default (publishable but bloated); confirm the reshape expectation."
  fi
  has_build=$(node -p "Object.hasOwn(JSON.parse(require('fs').readFileSync('$mf','utf8')), 'scripts') && Object.hasOwn(JSON.parse(require('fs').readFileSync('$mf','utf8')).scripts || {}, 'build')" 2>/dev/null || true)
  if [[ "$has_build" == "true" ]]; then
    note "$dir has a build script — run pnpm -C $dir build before publishing so the output is fresh."
  fi
  reg_v=$(npm view "$name" version </dev/null 2>/dev/null || true)
  if [[ -z "$reg_v" ]]; then
    TO_PUBLISH+=("$i")
    note "registry has no $name yet — first-release slot."
  elif [[ "$reg_v" == "0.1.0" ]]; then
    note "$name@0.1.0 is already on the registry (resume checkpoint: skipping this package)."
  else
    warn "$name already has version $reg_v on the registry — not the launch number; a human decides before continuing."
  fi
done
if (( PUBLISH_READY )); then
  say "Publish order: @xiechimon/cairn (main package, embeds web, npx main path) first,"
  say "then @xiechimon/cairn-cli — the two packages do not depend on each other; the order only makes the acceptance chain testable sooner."
  RECHECK=1
  if [[ -z "${NPM_PUBLISH_TOKEN:-}" && ${#TO_PUBLISH[@]} -gt 0 ]]; then
    warn "Token capture did not succeed — the publish commands are not shown. Re-run the wizard to complete Stage 3 token capture,"
    warn "then come back to publish; this wizard offers no tokenless direct-publish path."
    SKIPPED+=("launch execution (token not captured, publish commands not shown)")
    RECHECK=0
    V1="" V2=""
  elif [[ ${#TO_PUBLISH[@]} -eq 0 ]]; then
    note "Both packages are already registered — no pending publish commands; moving straight to the registry recheck."
  else
    say "Run the following commands line by line in your own terminal (not here); the token enters the command as a variable,"
    say "and does not land in the shell history. First put the token into the current shell:"
    step "bash/zsh: cd $REPO_ROOT && read -rs NPM_PUBLISH_TOKEN && export NPM_PUBLISH_TOKEN"
    step "fish: cd $REPO_ROOT; and read -s NPM_PUBLISH_TOKEN; and set -x NPM_PUBLISH_TOKEN \$NPM_PUBLISH_TOKEN"
    note "After read, paste then press Enter (no echo); if you have not copied the token since generating it on the page, go back and copy it now."
    for i in "${TO_PUBLISH[@]}"; do
      step "cd ${PKG_DIRS[$i]} && npm publish --access public --//registry.npmjs.org/:_authToken=\"\$NPM_PUBLISH_TOKEN\""
    done
    say "Each package's publish may prompt once for an OTP (account 2FA + token with bypass unchecked):"
    say "just type the 6-digit authenticator code — that is the second factor working, not a failure."
    note "The token only briefly appears as an argument in this machine's process list (ps); the command references the variable name,"
    note "and never enters the history. npm will print + @xiechimon/…@0.1.0 to the output — that means success."
    pause "Press Enter once both packages are published (or the resume checkpoint is complete); I will recheck the registry"
  fi
  if (( RECHECK )); then
    V1="" V2=""
    for round in 1 2 3; do
      V1=$(npm view "${PKG_NAMES[0]}" version </dev/null 2>/dev/null || true)
      V2=$(npm view "${PKG_NAMES[1]}" version </dev/null 2>/dev/null || true)
      [[ "$V1" == "0.1.0" && "$V2" == "0.1.0" ]] && break
      warn "The registry is not complete yet (cairn=${V1:-none} cli=${V2:-none}), pass $round."
      pause "Wait half a minute, then press Enter; I will re-check"
    done
    if [[ "$V1" == "0.1.0" && "$V2" == "0.1.0" ]]; then
      printf '  %s✓ registry recheck passed: @xiechimon/cairn@0.1.0 and @xiechimon/cairn-cli@0.1.0%s\n' "$GREEN" "$RESET"
    else
      warn "The registry recheck failed — publishing failed or is incomplete; go back a step and diagnose (E401→token, E403→permissions/2FA, 404→the command did not really run)."
      SKIPPED+=("registry recheck (both packages not present)")
    fi
  fi
else
  warn "Pre-flight check tripped: the #261 / #262 package reshape has not landed (see the specific warning lines above)."
  SKIPPED+=("launch execution (package-reshape prerequisite not landed, commands not shown)")
  SKIPPED+=("clean-environment npx acceptance (depends on the published packages)")
  V1="" V2=""
fi

stage "clean-environment npx acceptance (isolated temp HOME walks the full npx chain)"
ACCEPT_HOME=""
if [[ "${V1:-}" == "0.1.0" && "${V2:-}" == "0.1.0" ]]; then
  ACCEPT_PORT=""
  for p in 8791 8792 8793 8794 8795 8796 8797 8798 8799; do
    if ! lsof -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then ACCEPT_PORT="$p"; break; fi
  done
  if [[ -z "$ACCEPT_PORT" ]]; then
    warn "All of 8791-8799 are taken — no acceptance port left; the wizard exits (it never silently picks a busy port)."
    warn "Find the holder: lsof -iTCP:8791 -sTCP:LISTEN — it may be another lane, so do not kill it;"
    warn "re-run once the lane winds down (the wizard persists nothing, so the re-run cost = pasting the token again)."
    exit 1
  fi
  note "Acceptance port $ACCEPT_PORT (5173/8787 are the main-repo dev stack — do not touch; 8390/8399 are other lanes' territory)."
  ACCEPT_HOME=$(mktemp -d "${TMPDIR:-/tmp}/cairn-accept.XXXXXX")
  say "Isolated HOME: $ACCEPT_HOME — the npx cache and ~/.cairn data all land here; the whole directory is deleted after acceptance."
  say "Run this in your own terminal (env-prefix form works in bash / zsh / fish):"
  step "env PORT=$ACCEPT_PORT HOME=$ACCEPT_HOME npx -y @xiechimon/cairn"
  note "A cold cache downloads the whole package plus the better-sqlite3 prebuilt binary; a few dozen seconds is normal;"
  note "Node 22/24 LTS runs as-is; newer majors may compile in place (already stated in W2-D3)."
  pause "Press Enter once you see the server listening log (or while it is still downloading) — I will poll from here"
  APP_CODE=""
  for _ in $(seq 1 90); do
    APP_CODE=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:$ACCEPT_PORT/app" || true)
    [[ "$APP_CODE" == "200" ]] && break
    sleep 2
  done
  if [[ "$APP_CODE" == "200" ]]; then
    printf '  %s✓ GET /app → 200 (in-package web dist hosting works)%s\n' "$GREEN" "$RESET"
  else
    warn "GET /app → ${APP_CODE:-000}: web dist did not ship in the package or webDir resolution failed (see #261 failure mode 2)."
    SKIPPED+=("npx acceptance /app 200")
  fi
  ME_CODE=$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$ACCEPT_PORT/api/user/me" || true)
  if [[ "$ME_CODE" == "200" ]]; then
    printf '  %s✓ GET /api/user/me → 200 (seed user surface works)%s\n' "$GREEN" "$RESET"
  else
    warn "GET /api/user/me → ${ME_CODE:-000} (see #261 failure mode 3: migrate/seed did not ship in the package)."
    SKIPPED+=("npx acceptance /api/user/me 200")
  fi
  if [[ -f "$ACCEPT_HOME/.cairn/server/server.db" ]]; then
    printf '  %s✓ %s/.cairn/server/server.db exists (first boot created the database)%s\n' "$GREEN" "$ACCEPT_HOME" "$RESET"
  else
    warn "No .cairn/server/server.db under the isolated HOME — the first-boot database creation did not run."
    SKIPPED+=("first boot database creation")
  fi
  say "Next, verify the machine chain (W2-D5 second segment): create an API key in the web UI → install the cli globally → enroll."
  open_url "http://127.0.0.1:$ACCEPT_PORT/app/api-keys"
  step "Create a key (any name, e.g. accept); the secret shows once — copy it."
  step "npm install -g @xiechimon/cairn-cli    # the real user path, lands in this machine's global prefix"
  step "env HOME=$ACCEPT_HOME cairn start --api-key <paste that key> --team <teamId> --server http://127.0.0.1:$ACCEPT_PORT"
  note "teamId source: the teamId field in the server startup log, or the dashboard's Add Machine dialog,"
  note "and the command text shown by the Register with API key instead section (both carry a --team value/placeholder)."
  note "cairn start backgroundizes by default (it returns once enrollment completes); the machine name defaults to the hostname."
  open_url "http://127.0.0.1:$ACCEPT_PORT/app/resources/machines"
  confirm "Does the machine list now show your hostname row?" || warn "If not, go back to the terminal and read cairn's error (enroll 401→mis-copied key; 404→wrong --server port)"
  say "Cleanup (once enrollment checks out):"
  step "Ctrl-C to stop the npx server"
  step "env HOME=$ACCEPT_HOME cairn stop"
  step "npm rm -g @xiechimon/cairn-cli    # optional — leaving it means it is the real cli on your machine"
  if confirm "Should I delete the isolated directory $ACCEPT_HOME now?"; then
    rm -rf "$ACCEPT_HOME" && note "✓ deleted $ACCEPT_HOME"
  fi
else
  warn "Skipped: the two packages are not both published yet (registry is not double 0.1.0). Go back to Stage 4 and finish publishing."
fi

stage "close-out and aftercare"
say "Dispose of the launch token afterwards: go back to the tokens page and delete the launch token (especially if you took the All Packages fallback);"
say "for routine future publishes, just npm login + OTP — no long-lived token is needed."
open_url "https://www.npmjs.com/settings/${NPM_USERNAME}/tokens"
step "Tokens list → find cairn-first-publish-0.1.0 → Delete."
note "This wizard wrote no credentials to disk (.env and .npmrc were both left alone); the token disappears with the process."
note "W2 close-out checklist: #265 README quickstart switches to the npx form, #264 CI pack smoke, and"
note "#266 first-release run record (this wizard's real first run is written up in #266)."

finish