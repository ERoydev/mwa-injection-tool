#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Auto-detect ADB if not already in PATH
if ! command -v adb &>/dev/null; then
  if [ -n "${ANDROID_HOME:-}" ] && [ -x "$ANDROID_HOME/platform-tools/adb" ]; then
    export PATH="$ANDROID_HOME/platform-tools:$PATH"
  elif [ -x "$HOME/Library/Android/sdk/platform-tools/adb" ]; then
    export PATH="$HOME/Library/Android/sdk/platform-tools:$PATH"
  elif [ -x "$HOME/Android/Sdk/platform-tools/adb" ]; then
    export PATH="$HOME/Android/Sdk/platform-tools:$PATH"
  else
    echo "Error: adb not found. Install Android SDK Platform Tools or set ANDROID_HOME." >&2
    exit 1
  fi
fi

exec node "$PROJECT_DIR/dist/cli.js" "$@"
