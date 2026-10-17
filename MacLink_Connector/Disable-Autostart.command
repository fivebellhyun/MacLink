#!/bin/bash
set -euo pipefail
agent_dir="$HOME/Library/Application Support/MacLink"
if [ ! -x "$agent_dir/venv/bin/python" ]; then echo 'MacLink is not installed.'; exit 0; fi
"$agent_dir/venv/bin/python" "$agent_dir/autostart.py" disable
