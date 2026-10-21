#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
echo 'MacLink always-on setup: stop any existing connector before continuing.'
echo 'Connect from My Devices after signing in with the Google account that registered this Mac.'
bash ./Start-MacLink.command --always-on
