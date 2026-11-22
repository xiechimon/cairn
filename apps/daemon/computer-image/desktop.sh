#!/bin/bash
set -euo pipefail
cd "$HOME"
config=$HOME/.config
rm -f /run/cairn/ready /tmp/.X1-lock /tmp/.X11-unix/X1
mkdir -p "$config/gtk-3.0" "$config/openbox" "$config/plank/dock1/launchers" "$HOME/.cairn" "$HOME/.local/bin"
printf '[Settings]\ngtk-application-prefer-dark-theme=1\ngtk-theme-name=Adwaita-dark\n' > "$config/gtk-3.0/settings.ini"
sed 's#</applications>#<application class="*" type="normal"><maximized>yes</maximized></application></applications>#' /etc/xdg/openbox/rc.xml > "$config/openbox/rc.xml"
rm -f "$config/plank/dock1/launchers/"*.dockitem
for app in cairn-chromium cairn-browser lxterminal; do
  printf '[PlankDockItemPreferences]\nLauncher=file:///usr/share/applications/%s.desktop\n' "$app" > "$config/plank/dock1/launchers/$app.dockitem"
done
exec dbus-run-session -- bash -s <<'SESSION'
set -euo pipefail
export DISPLAY=:1 ACCESSIBILITY_ENABLED=1
Xvfb :1 -screen 0 1600x1000x24 -nolisten tcp &
cairn-wait-display :1 || exit 1
dbus-update-activation-environment DISPLAY ACCESSIBILITY_ENABLED
printf 'export DISPLAY=:1 ACCESSIBILITY_ENABLED=1 GTK_A11Y=atspi QT_ACCESSIBILITY=1 DBUS_SESSION_BUS_ADDRESS=%q\n' "$DBUS_SESSION_BUS_ADDRESS" > /run/cairn/session.env
hsetroot -solid '#1e1e2e' >/dev/null 2>&1 || true
openbox &
picom &
dock=net.launchpad.plank.dock.settings:/net/launchpad/plank/docks/dock1/
gsettings set "$dock" hide-mode none 2>/dev/null || true
plank >/tmp/plank.log 2>&1 &
sleep 1
gsettings set "$dock" hide-mode intelligent 2>/dev/null || true
gsettings set "$dock" hide-mode none 2>/dev/null || true
x11vnc -display :1 -rfbport 5900 -nopw -forever -shared -quiet -gone "xdotool keyup Shift_L Shift_R Control_L Control_R Alt_L Alt_R Meta_L Meta_R Super_L Super_R Hyper_L Hyper_R ISO_Level3_Shift Mode_switch" &
x11vnc -display :1 -rfbport 5901 -viewonly -nopw -forever -shared -quiet &
touch /run/cairn/ready
wait -n
exit 1
SESSION
