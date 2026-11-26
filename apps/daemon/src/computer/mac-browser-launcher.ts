import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const REAL_BROWSER_ENV = 'CAIRN_BROWSER_EXECUTABLE';

const SCRIPT = `#!/bin/sh
port=0
profile=
for argument in "$@"; do
  case "$argument" in
    --remote-debugging-port=*) port=\${argument#*=} ;;
    --user-data-dir=*) profile=\${argument#*=} ;;
  esac
done
if [ -n "$profile" ] && [ "$port" != 0 ]; then
  (
    tries=0
    while [ "$tries" -lt 300 ] && kill -0 $$; do
      if /usr/sbin/lsof -nP -a -p $$ -iTCP:"$port" -sTCP:LISTEN; then
        path=$(/usr/bin/curl -s -m 2 --noproxy '*' "http://127.0.0.1:$port/json/version" | /usr/bin/sed -n 's|.*"webSocketDebuggerUrl": *"ws://[^/]*\\(/[^"]*\\)".*|\\1|p')
        if [ -n "$path" ]; then
          printf '%s\\n%s' "$port" "$path" > "$profile/DevToolsActivePort"
          break
        fi
      fi
      sleep 0.1
      tries=$((tries + 1))
    done
  ) </dev/null >/dev/null 2>&1 &
fi
exec "$${REAL_BROWSER_ENV}" "$@"
`;

export function writeBrowserLauncher(directory: string): string {
  const launcher = join(directory, 'browser-launcher');
  writeFileSync(launcher, SCRIPT, { mode: 0o700 });
  return launcher;
}
