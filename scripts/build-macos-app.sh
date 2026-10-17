#!/bin/bash
# Build a self-contained menu bar app and an architecture-specific drag-to-install DMG.
set -euo pipefail
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
install_app=0
make_dmg=1
run_self_test=1
for argument in "$@"; do
 case "$argument" in
  --install) install_app=1 ;;
  --no-dmg) make_dmg=0 ;;
  --no-self-test) run_self_test=0 ;;
  --help|-h)
   echo 'Usage: bash scripts/build-macos-app.sh [--install] [--no-dmg] [--no-self-test]'
   echo 'Requires macOS 13+ and Python 3.11-3.14. Output: dist/MacLink.app and dist/MacLink-Connector-ARCH.dmg.'
   echo '--no-self-test builds without invoking the app executable; static signature and macOS checks still run.'
   echo '--install copies the app into ~/Applications; it does not launch it or enable login startup.'
   exit 0 ;;
  *) echo "Unknown argument: $argument" >&2; exit 2 ;;
 esac
done
[ "$(uname -s)" = Darwin ] || { echo 'Build MacLink.app on macOS.' >&2; exit 1; }
build_python="${MACLINK_BUILD_PYTHON:-}"
if [ -z "$build_python" ]; then
 for candidate in python3.12 python3.13 python3.11 python3; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; assert (3,11) <= sys.version_info[:2] < (3,15)' 2>/dev/null; then
   build_python="$(command -v "$candidate")"; break
  fi
 done
fi
[ -n "$build_python" ] || { echo 'Install Python 3.11-3.14 to build. The resulting app includes Python.' >&2; exit 1; }
"$build_python" -c 'import sys; assert (3,11) <= sys.version_info[:2] < (3,15), "Use Python 3.11-3.14"'
build_dir="$project_dir/.build/maclink"
mkdir -p "$build_dir" "$project_dir/dist"
if [ -x "$build_dir/venv/bin/python" ]; then
 requested_prefix="$("$build_python" -c 'import os,sys; print(os.path.realpath(sys.base_prefix))')"
 existing_prefix="$("$build_dir/venv/bin/python" -c 'import os,sys; print(os.path.realpath(sys.base_prefix))')"
 if [ "$requested_prefix" != "$existing_prefix" ]; then
  echo 'Build Python changed; recreating the project-local build virtual environment.'
  rm -rf "$build_dir/venv"
 fi
fi
if [ ! -x "$build_dir/venv/bin/python" ]; then "$build_python" -m venv "$build_dir/venv"; fi
python_bin="$build_dir/venv/bin/python"
"$python_bin" -m pip install --disable-pip-version-check -r "$project_dir/MacLink_Connector/requirements.txt" 'pyinstaller==6.22.3'
"$python_bin" "$project_dir/scripts/create-app-icon.py" "$build_dir/MacLink.icns"
"$python_bin" "$project_dir/scripts/collect-runtime-notices.py" "$build_dir/notices"
"$python_bin" -m PyInstaller --noconfirm --clean --distpath "$project_dir/dist" --workpath "$build_dir/work" "$project_dir/MacLink_Connector/MacLink.spec"
app_path="$project_dir/dist/MacLink.app"
"$python_bin" "$project_dir/scripts/verify-macos-target.py" "$app_path" --target 13.0
if [ "$run_self_test" = 1 ]; then "$app_path/Contents/MacOS/MacLink" --self-test; fi
/usr/bin/codesign --verify --deep --strict "$app_path"
if [ "$make_dmg" = 1 ]; then
 architecture="$("$python_bin" -c 'import platform; print(platform.machine())')"
 stage="$(mktemp -d "$build_dir/dmg.XXXXXX")"
 trap 'rm -rf "$stage"' EXIT
 /usr/bin/ditto "$app_path" "$stage/MacLink.app"
 ln -s /Applications "$stage/Applications"
 cp "$project_dir/MacLink_Connector/README.txt" "$stage/Read Me.txt"
 image_path="$project_dir/dist/MacLink-Connector-$architecture.dmg"
 /usr/bin/hdiutil create -volname 'MacLink Connector' -srcfolder "$stage" -ov -format UDZO "$image_path"
 (cd "$project_dir/dist" && /usr/bin/shasum -a 256 "$(basename "$image_path")" > "$(basename "$image_path").sha256")
 echo "Built $image_path (SHA-256 file alongside it)."
fi
if [ "$install_app" = 1 ]; then
 destination="$HOME/Applications/MacLink.app"
 [ ! -e "$destination" ] || { echo "Quit MacLink and move the existing $destination aside before installing this build." >&2; exit 1; }
 mkdir -p "$HOME/Applications"
 /usr/bin/ditto "$app_path" "$destination"
 echo "Installed $destination. Open it to set up the connector."
fi
echo "Built $app_path"
