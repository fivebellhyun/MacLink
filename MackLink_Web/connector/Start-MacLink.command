#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
if [ "$(uname -s)" != "Darwin" ]; then echo 'This program requires macOS.'; exit 1; fi
agent_python=''
for candidate in /opt/homebrew/bin/python3.13 /opt/homebrew/bin/python3.12 /opt/homebrew/bin/python3.11 /usr/local/bin/python3.13 /usr/local/bin/python3.12 /usr/local/bin/python3.11 /usr/local/bin/python3 python3; do
 if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; assert sys.version_info >= (3,11) and sys.version_info < (3,15)' 2>/dev/null; then agent_python="$(command -v "$candidate")"; break; fi
done
if [ -z "$agent_python" ]; then
 echo 'Python 3.11-3.14 is required. Install Python for macOS from python.org, then try again.'
 open 'https://www.python.org/downloads/macos/'
 read -r -p 'Press Enter to close. ' ignored
 exit 1
fi
agent_dir="$HOME/Library/Application Support/MacLink"
mkdir -p "$agent_dir"
chmod 700 "$agent_dir"
cp maclink.py app_runtime.py protocol.py media.py quality.py requirements.txt configure.py autostart.py diagnose.py "$agent_dir/"
if [ ! -x "$agent_dir/venv/bin/python" ]; then "$agent_python" -m venv "$agent_dir/venv"; fi
if [ ! -f "$agent_dir/installed-requirements.txt" ] || ! cmp -s requirements.txt "$agent_dir/installed-requirements.txt"; then
 echo 'Installing the libraries required by MacLink. The first installation may take a few minutes.'
 "$agent_dir/venv/bin/python" -m pip install --upgrade pip
 "$agent_dir/venv/bin/python" -m pip install -r "$agent_dir/requirements.txt"
 cp requirements.txt "$agent_dir/installed-requirements.txt"
fi
"$agent_dir/venv/bin/python" "$agent_dir/configure.py"
if [ "${1:-}" = "--always-on" ]; then
 "$agent_dir/venv/bin/python" "$agent_dir/autostart.py" enable --yes
 if ! "$agent_dir/venv/bin/python" "$agent_dir/diagnose.py" --wait 15; then
  echo 'Installation finished, but the online connection could not be confirmed. Review the diagnostic results above.'
  read -r -p 'Press Enter to close. ' ignored
  exit 1
 fi
 exit 0
fi
echo 'Allow Screen Recording and Accessibility in System Settings. Press Ctrl+C to stop.'
exec "$agent_dir/venv/bin/python" "$agent_dir/maclink.py" --config "$agent_dir/config.json"
