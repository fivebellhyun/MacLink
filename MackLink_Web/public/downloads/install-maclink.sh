#!/bin/bash
# Install a published DMG. Do not strip quarantine or bypass Gatekeeper.
set -euo pipefail
destination_dir="$HOME/Applications"
release=latest
open_app=1
while [ "$#" -gt 0 ]; do
 case "$1" in
  --dir|--version)
   [ "$#" -ge 2 ] || { echo "Missing value for $1" >&2; exit 2; }
   case "$1" in --dir) destination_dir="$2" ;; --version) release="$2" ;; esac
   shift 2 ;;
  --no-open) open_app=0; shift ;;
  --help|-h)
   echo 'Usage: bash install-maclink.sh [--dir PATH] [--version TAG] [--no-open]'
   echo 'Downloads the matching MacLink release DMG, checks SHA-256, and installs into ~/Applications.'
   echo 'Quit an existing MacLink app before updating. Device keys are preserved.'
   exit 0 ;;
  *) echo "Unknown argument: $1" >&2; exit 2 ;;
 esac
done
[ "$(uname -s)" = Darwin ] || { echo 'MacLink requires macOS 13 or later.' >&2; exit 1; }
case "$release" in ''|*[!a-zA-Z0-9._-]*) echo 'Invalid release tag.' >&2; exit 2 ;; esac
architecture="$(uname -m)"
case "$architecture" in arm64|x86_64) ;; *) echo "Unsupported architecture: $architecture" >&2; exit 1 ;; esac
if pgrep -x MacLink >/dev/null 2>&1; then
 echo 'Quit MacLink from its menu bar before installing or updating.' >&2; exit 1
fi
asset="MacLink-Connector-$architecture.dmg"
base='https://github.com/fivebellhyun/MacLink/releases'
if [ "$release" = latest ]; then base="$base/latest/download"; else base="$base/download/$release"; fi
temporary="$(mktemp -d "${TMPDIR:-/tmp}/maclink-install.XXXXXX")"
mounted=0
stage=''
restore=0
destination="$destination_dir/MacLink.app"
cleanup() {
 if [ "$restore" = 1 ] && [ ! -e "$destination" ] && [ -d "$stage/Previous.app" ]; then
  mv "$stage/Previous.app" "$destination"
 fi
 if [ "$mounted" = 1 ]; then /usr/bin/hdiutil detach "$temporary/mount" -quiet || true; fi
 [ -z "$stage" ] || rm -rf "$stage"
 rm -rf "$temporary"
}
trap cleanup EXIT
echo "Downloading $asset from release $release..."
if ! curl --fail --location --silent --show-error --proto '=https' --tlsv1.2 "$base/$asset" -o "$temporary/$asset" ||
   ! curl --fail --location --silent --show-error --proto '=https' --tlsv1.2 "$base/$asset.sha256" -o "$temporary/checksum"; then
 echo 'No downloadable build was found. See https://github.com/fivebellhyun/MacLink/releases or build from source with scripts/build-macos-app.sh.' >&2
 exit 1
fi
expected="$(awk 'NR == 1 {print $1}' "$temporary/checksum")"
if [ "${#expected}" -ne 64 ]; then echo 'Invalid SHA-256 file.' >&2; exit 1; fi
case "$expected" in *[!a-fA-F0-9]*) echo 'Invalid SHA-256 file.' >&2; exit 1 ;; esac
actual="$(shasum -a 256 "$temporary/$asset" | awk '{print $1}')"
if [ "$(printf '%s' "$expected" | tr 'A-F' 'a-f')" != "$actual" ]; then
 echo 'SHA-256 verification failed. Nothing was installed.' >&2; exit 1
fi
mkdir "$temporary/mount"
/usr/bin/hdiutil attach "$temporary/$asset" -readonly -nobrowse -mountpoint "$temporary/mount" -quiet
mounted=1
source_app="$temporary/mount/MacLink.app"
bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$source_app/Contents/Info.plist")"
[ "$bundle_id" = com.maclink.connector ] || { echo 'Unexpected application bundle.' >&2; exit 1; }
/usr/bin/codesign --verify --deep --strict "$source_app"
mkdir -p "$destination_dir"
stage="$(mktemp -d "$destination_dir/.maclink-install.XXXXXX")"
/usr/bin/ditto "$source_app" "$stage/MacLink.app"
if [ -e "$destination" ]; then
 mv "$destination" "$stage/Previous.app"
 restore=1
fi
mv "$stage/MacLink.app" "$destination"
restore=0
echo "Installed $destination. Device keys were preserved."
echo 'For unsigned releases, review macOS Privacy & Security if Gatekeeper blocks opening the app.'
if [ "$open_app" = 1 ]; then /usr/bin/open "$destination"; fi
