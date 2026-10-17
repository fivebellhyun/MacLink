#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
agent_dir="$HOME/Library/Application Support/MacLink"
if [ ! -x "$agent_dir/venv/bin/python" ]; then
 echo 'First, run Enable-Always-On.command from the latest download to install MacLink.'
else
 "$agent_dir/venv/bin/python" ./diagnose.py || true
fi
read -r -p 'Press Enter to close. ' ignored
