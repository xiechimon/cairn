#!/bin/bash
set -euo pipefail
state=/run/cairn
profile=$HOME/.cairn/cloak-profile
env_file=$state/cloak.env
key_file=$state/cloak.key
owner_pid=$state/owner.pid
export DISPLAY=:1

read_key() {
  key=
  IFS= read -r key < "$key_file" || [[ -n $key ]]
  [[ -n $key ]]
}

owner_alive() {
  local pid
  [[ -r $owner_pid ]] || return 1
  pid=$(< "$owner_pid")
  [[ $pid =~ ^[1-9][0-9]*$ ]] && kill -0 "$pid" 2>/dev/null
}

lock_released() {
  local lock=$profile/SingletonLock owner pid
  for _ in $(seq 100); do
    [[ -L $lock ]] || return 0
    owner=$(readlink "$lock")
    pid=${owner##*-}
    [[ $pid =~ ^[0-9]+$ ]] || return 1
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.1
  done
  return 1
}

quit_windows() {
  python3 - "$@" <<'PY'
import ctypes, os, sys
x11 = ctypes.CDLL("libX11.so.6")
x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XInternAtom.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
x11.XInternAtom.restype = ctypes.c_ulong
x11.XSendEvent.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_long, ctypes.c_void_p]
x11.XFlush.argtypes = [ctypes.c_void_p]
x11.XCloseDisplay.argtypes = [ctypes.c_void_p]

class ClientMessageData(ctypes.Union):
    _fields_ = [("b", ctypes.c_char * 20), ("s", ctypes.c_short * 10), ("l", ctypes.c_long * 5)]

class XClientMessageEvent(ctypes.Structure):
    _fields_ = [
        ("type", ctypes.c_int),
        ("serial", ctypes.c_ulong),
        ("send_event", ctypes.c_int),
        ("display", ctypes.c_void_p),
        ("window", ctypes.c_ulong),
        ("message_type", ctypes.c_ulong),
        ("format", ctypes.c_int),
        ("data", ClientMessageData),
    ]

dpy = x11.XOpenDisplay(os.environ.get("DISPLAY", ":1").encode())
if not dpy:
    sys.exit(1)
wm_protocols = x11.XInternAtom(dpy, b"WM_PROTOCOLS", 0)
wm_delete = x11.XInternAtom(dpy, b"WM_DELETE_WINDOW", 0)
for arg in sys.argv[1:]:
    win = int(arg, 0)
    ev = XClientMessageEvent()
    ev.type = 33
    ev.display = dpy
    ev.window = win
    ev.message_type = wm_protocols
    ev.format = 32
    ev.data.l[0] = wm_delete
    ev.data.l[1] = 0
    x11.XSendEvent(dpy, win, 0, 0, ctypes.byref(ev))
x11.XFlush(dpy)
x11.XCloseDisplay(dpy)
PY
}

launch_owner() {
  local url=$1 pid
  read_key || { echo 'No CloakBrowser license; set team secret CLOAKBROWSER_LICENSE_KEY' >&2; exit 2; }
  . "$env_file"
  read -r -a args <<< "$CAIRN_CLOAK_ARGS"
  CLOAKBROWSER_LICENSE_KEY=$key setsid "$CAIRN_CLOAK_EXECUTABLE" "${args[@]}" "--user-data-dir=$profile" ${url:+"$url"} >/dev/null 2>&1 < /dev/null &
  pid=$!
  printf '%s\n' "$pid" > "$owner_pid"
  for _ in $(seq 100); do
    kill -0 "$pid" 2>/dev/null || { echo 'The owner browser could not be started' >&2; exit 1; }
    xdotool search --onlyvisible --pid "$pid" >/dev/null 2>&1 && exit 0
    sleep 0.1
  done
  echo 'The owner browser could not be started' >&2
  exit 1
}

case ${1:-} in
  key)
    umask 077
    cat > "$key_file.tmp"
    mv -f "$key_file.tmp" "$key_file"
    chmod 400 "$key_file"
    ;;
  prepare)
    read_key || { echo 'The CloakBrowser license is not set in this computer' >&2; exit 2; }
    mkdir -p "$profile"
    CLOAKBROWSER_LICENSE_KEY=$key exec node /opt/cloak/cloak.mjs "$profile" "$env_file" "${2:-}" "${3:-}"
    ;;
  owner)
    session=${2:?session}
    owner_alive && exit 0
    [[ -r $env_file ]] || exit 0
    agent-browser --json session list 2>/dev/null | grep -qF "\"$session\"" || exit 0
    current=$(agent-browser --session "$session" get url 2>/dev/null | tail -n 1 || true)
    url=
    [[ $current =~ ^https?:// ]] && url=$current
    agent-browser --session "$session" close >/dev/null 2>&1 || { echo 'The agent browser did not close' >&2; exit 1; }
    lock_released || { echo 'The agent browser did not close' >&2; exit 1; }
    launch_owner "$url"
    ;;
  agent)
    owner_alive || exit 0
    pid=$(< "$owner_pid")
    windows=$(xdotool search --onlyvisible --pid "$pid" 2>/dev/null || true)
    [[ -n $windows ]] || { echo 'The owner browser did not close' >&2; exit 1; }
    quit_windows $windows || { echo 'The owner browser did not close' >&2; exit 1; }
    for _ in $(seq 100); do
      if ! kill -0 "$pid" 2>/dev/null; then
        rm -f "$owner_pid"
        lock_released && exit 0
        break
      fi
      sleep 0.1
    done
    echo 'The owner browser did not close' >&2
    exit 1
    ;;
  quit)
    session=${2:?session}
    "$0" agent
    agent-browser --session "$session" close >/dev/null 2>&1 || true
    agent-browser --session "${session%-stealth}" close >/dev/null 2>&1 || true
    lock_released
    ;;
  open)
    owner_alive && exit 0
    [[ -r $env_file ]] || { echo 'Open the stealth browser once from the agent first' >&2; exit 2; }
    lock_released || { echo 'The agent is using the stealth browser' >&2; exit 1; }
    launch_owner ''
    ;;
  *)
    echo 'usage: cairn-browser key|prepare|owner|agent|quit|open' >&2
    exit 64
    ;;
esac
