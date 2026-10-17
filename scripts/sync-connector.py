"""Keep the website's legacy source download consistent with the canonical connector.

The default distribution is MacLink.app/DMG. The ZIP remains for existing source users.
Run from any directory; --check verifies without writing.
"""
import argparse
import io
from pathlib import Path
import sys
import zipfile

PROJECT = Path(__file__).resolve().parents[1]


def expected_files():
    source = PROJECT / 'MacLink_Connector'
    files = {path.name: path.read_bytes() for path in source.iterdir()
             if path.is_file() and path.suffix in ('.py', '.command', '.txt')}
    icon = source / 'maclink_icon.png'
    if not icon.is_file():
        raise FileNotFoundError('Required connector asset is missing: MacLink_Connector/maclink_icon.png')
    files[icon.name] = icon.read_bytes()
    files['LICENSE'] = (PROJECT / 'LICENSE.md').read_bytes()
    files['THIRD_PARTY_NOTICES.md'] = (PROJECT / 'THIRD_PARTY_NOTICES.md').read_bytes()
    return files


def archive_bytes(files):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in sorted(files.items()):
            info = zipfile.ZipInfo('MacLink_Connector/' + name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (0o100755 if name.endswith('.command') else 0o100644) << 16
            archive.writestr(info, content)
    return stream.getvalue()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    mirror = PROJECT / 'MackLink_Web/connector'
    targets = {mirror / name: content for name, content in expected_files().items()}
    targets[PROJECT / 'MackLink_Web/public/downloads/MacLink-Connector.zip'] = archive_bytes(expected_files())
    targets[PROJECT / 'MackLink_Web/public/downloads/install-maclink.sh'] = (PROJECT / 'scripts/install-maclink.sh').read_bytes()
    mismatches = []
    for path, content in targets.items():
        if not path.exists() or path.read_bytes() != content:
            mismatches.append(str(path.relative_to(PROJECT)))
            if not args.check:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(content)
                if path.suffix == '.command':
                    path.chmod(0o755)
    if args.check and mismatches:
        print('Run python3 scripts/sync-connector.py; stale files:\n' + '\n'.join(mismatches), file=sys.stderr)
        return 1
    print('Connector mirror, legacy ZIP and installer are synchronized.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
