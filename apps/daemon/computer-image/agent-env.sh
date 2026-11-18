export PIP_USER=1
export PIP_BREAK_SYSTEM_PACKAGES=1
export NPM_CONFIG_PREFIX="$HOME/.local"
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) export PATH="$HOME/.local/bin:$PATH" ;;
esac
[ -r /run/cairn/session.env ] && . /run/cairn/session.env
