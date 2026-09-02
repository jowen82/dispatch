#!/bin/zsh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
APP_HOME="$HOME/Dispatch"
mkdir -p "$APP_HOME/logs"
LOG="$APP_HOME/logs/bootstrap.log"
exec > >(tee -a "$LOG") 2>&1

echo "Dispatch bootstrap"
echo "Package: $ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
  osascript -e 'display alert "Unsupported platform" message "Version 0.1 currently targets macOS." as critical'
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    answer=$(osascript -e 'button returned of (display dialog "Python 3 is required and was not found. Install it with Homebrew?" buttons {"Cancel","Install"} default button "Install")')
    [[ "$answer" == "Install" ]] || exit 1
    brew install python@3.12
  else
    answer=$(osascript -e 'button returned of (display dialog "Homebrew and Python 3 are not installed. Open the Homebrew installation page?" buttons {"Cancel","Open"} default button "Open")')
    [[ "$answer" == "Open" ]] || exit 1
    open "https://brew.sh/"
    osascript -e 'display dialog "Install Homebrew, then run bootstrap.command again." buttons {"OK"} default button "OK"'
    exit 0
  fi
fi

cp -R "$ROOT/studio" "$APP_HOME/" 2>/dev/null || true
cp "$ROOT/VERSION" "$APP_HOME/VERSION" 2>/dev/null || true
cp "$ROOT/run.command" "$APP_HOME/run.command" 2>/dev/null || true
chmod +x "$APP_HOME/run.command"

cd "$ROOT"
python3 -m studio.app --package-root "$ROOT" --home "$APP_HOME" --open-browser
