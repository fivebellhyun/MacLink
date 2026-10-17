#!/bin/bash
set -euo pipefail
agent_dir="$HOME/Library/Application Support/MacLink"
if [ ! -x "$agent_dir/venv/bin/python" ]; then echo 'Run Start-MacLink.command first.'; exit 1; fi
"$agent_dir/venv/bin/python" "$agent_dir/autostart.py" enable
