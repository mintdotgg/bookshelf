#!/bin/sh

set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
module_dir="$project_dir/.local-tools/python"

supports_yt_dlp() {
  "$1" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' \
    >/dev/null 2>&1
}

python_bin=${YT_DLP_PYTHON_PATH:-}

if [ -n "$python_bin" ] && supports_yt_dlp "$python_bin"; then
  :
elif [ -x /opt/homebrew/bin/python3.12 ] &&
  supports_yt_dlp /opt/homebrew/bin/python3.12; then
  python_bin=/opt/homebrew/bin/python3.12
elif [ -x /opt/homebrew/bin/python3 ] &&
  supports_yt_dlp /opt/homebrew/bin/python3; then
  python_bin=/opt/homebrew/bin/python3
elif command -v python3 >/dev/null 2>&1 &&
  supports_yt_dlp "$(command -v python3)"; then
  python_bin=$(command -v python3)
else
  echo "yt-dlp requires Python 3.10 or newer." >&2
  exit 127
fi

if [ ! -d "$module_dir/yt_dlp" ]; then
  echo "The repo-local yt-dlp package is missing from $module_dir." >&2
  echo "Install it with: $python_bin -m pip install --upgrade --target \"$module_dir\" yt-dlp" >&2
  exit 127
fi

if [ -n "${PYTHONPATH:-}" ]; then
  export PYTHONPATH="$module_dir:$PYTHONPATH"
else
  export PYTHONPATH="$module_dir"
fi

exec "$python_bin" -m yt_dlp "$@"
