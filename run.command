#!/bin/zsh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
if [[ -d "$HERE/studio" ]]; then
  ROOT="$HERE"
  HOME_DIR="$HOME/Dispatch"
else
  ROOT="$HOME/Dispatch"
  HOME_DIR="$ROOT"
fi
cd "$ROOT"
python3 -m studio.app --package-root "$ROOT" --home "$HOME_DIR" --open-browser
