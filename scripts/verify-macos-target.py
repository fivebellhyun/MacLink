"""Reject embedded Mach-O binaries that require a newer macOS than the app target."""
import argparse
import os
from pathlib import Path
import re
import subprocess
import sys


MACHO_MAGIC = {
    bytes.fromhex(value) for value in (
        'feedface', 'cefaedfe', 'feedfacf', 'cffaedfe',
        'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca',
    )
}


def version_tuple(value):
    parts = tuple(int(part) for part in value.split('.'))
    return (parts + (0, 0, 0))[:3]


def minimum_versions(output):
    """Read both modern and legacy load commands, including every fat slice."""
    versions = []
    for command in re.split(r'(?m)^Load command \d+\s*$', output):
        if re.search(r'(?m)^\s*cmd LC_BUILD_VERSION\s*$', command):
            match = re.search(r'(?m)^\s*minos (\d+(?:\.\d+){0,2})\s*$', command)
        elif re.search(r'(?m)^\s*cmd LC_VERSION_MIN_MACOSX\s*$', command):
            match = re.search(r'(?m)^\s*version (\d+(?:\.\d+){0,2})\s*$', command)
        else:
            continue
        if not match:
            raise ValueError('macOS minimum-version load command has no version')
        versions.append(match[1])
    return versions


def macho_files(app):
    # Framework aliases and all other symlinks are intentionally skipped.
    for folder, directories, files in os.walk(app, followlinks=False):
        directories[:] = [name for name in directories if not (Path(folder) / name).is_symlink()]
        for name in files:
            path = Path(folder) / name
            if path.is_symlink() or not path.is_file():
                continue
            with path.open('rb') as stream:
                if stream.read(4) in MACHO_MAGIC:
                    yield path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('app', type=Path)
    parser.add_argument('--target', default='13.0', help='Declared minimum macOS version (default: 13.0)')
    args = parser.parse_args()
    if not re.fullmatch(r'\d+(?:\.\d+){0,2}', args.target):
        parser.error('--target must be a macOS version such as 13.0')
    if not args.app.is_dir():
        parser.error('app bundle does not exist: ' + str(args.app))
    target = version_tuple(args.target)
    failures = []
    checked = 0
    for path in macho_files(args.app):
        checked += 1
        try:
            result = subprocess.run(['/usr/bin/otool', '-l', str(path)], check=True,
                                    capture_output=True, text=True)
            versions = minimum_versions(result.stdout)
            if not versions:
                raise ValueError('no macOS minimum-version load command found')
            for minimum in versions:
                if version_tuple(minimum) > target:
                    failures.append(f'{path.relative_to(args.app)} requires macOS {minimum}')
        except (OSError, ValueError, subprocess.CalledProcessError) as error:
            failures.append(f'{path.relative_to(args.app)} could not be verified: {error}')
    if not checked:
        failures.append('No Mach-O binaries were found in the app bundle.')
    if failures:
        print(f'The app cannot target macOS {args.target}:', file=sys.stderr)
        print('\n'.join('  ' + failure for failure in failures), file=sys.stderr)
        print('Use MACLINK_BUILD_PYTHON with a Python distribution that supports this macOS target, '
              'and dependencies built for the same or an older macOS version.', file=sys.stderr)
        return 1
    print(f'Verified {checked} Mach-O binaries: minimum macOS versions are at most {args.target}.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
