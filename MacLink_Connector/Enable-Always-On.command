#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
echo 'MacLink 1.2.3 always-on setup: stop any existing connector before continuing.'
echo 'Permanent access links allow connections without repeated approval on this Mac.'
bash ./Start-MacLink.command --always-on
