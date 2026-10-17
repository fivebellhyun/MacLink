"""Preserve license files and exact dependency versions in the frozen distribution."""
import importlib.metadata
import json
from pathlib import Path
import shutil
import sys
import sysconfig


def collect(destination):
    destination = Path(destination)
    generated_root = Path(__file__).resolve().parents[1] / '.build'
    if not destination.resolve().is_relative_to(generated_root.resolve()):
        raise ValueError('Runtime notices must be generated inside the project .build folder.')
    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True, exist_ok=True)
    manifest = {'python': sys.version, 'packages': []}
    for distribution in sorted(importlib.metadata.distributions(), key=lambda item: item.metadata['Name'].lower()):
        name = distribution.metadata['Name']
        # PyInstaller's bootloader is shipped; retain its license and exception too.
        if name.lower() in ('pip', 'setuptools', 'pyinstaller-hooks-contrib', 'altgraph', 'macholib', 'packaging'):
            continue
        copied = []
        for entry in distribution.files or []:
            if not any(marker in str(entry).lower() for marker in ('license', 'licence', 'copying', 'notice', 'authors')):
                continue
            source = Path(distribution.locate_file(entry))
            if not source.is_file() or source.suffix.lower() in ('.so', '.dylib', '.dll', '.py', '.pyc', '.yml', '.yaml'):
                continue
            relative = Path(name) / Path(str(entry)).name
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            copied.append(str(relative))
        manifest['packages'].append({'name': name, 'version': distribution.version,
                                    'project_urls': distribution.metadata.get_all('Project-URL') or [],
                                    'license_files': copied})
    python_license = Path(sysconfig.get_path('stdlib')) / 'LICENSE.txt'
    if not python_license.is_file():
        python_license = Path(sys.base_prefix) / 'LICENSE'
    if not python_license.is_file():
        raise SystemExit('The build Python must provide its LICENSE or stdlib/LICENSE.txt for redistribution.')
    shutil.copyfile(python_license, destination / 'Python-LICENSE.txt')
    for license_file in Path(__file__).with_name('licenses').glob('*.txt'):
        shutil.copyfile(license_file, destination / license_file.name)
    (destination / 'FFmpeg.txt').write_text(
        'PyAV bundles dynamically linked FFmpeg libraries under LGPL v3 or later.\n'
        'FFmpeg: https://ffmpeg.org/\n'
        'Source releases: https://ffmpeg.org/releases/\n'
        'PyAV wheel build recipes: https://github.com/PyAV/av-wheels\n'
        'Exact PyAV package version is recorded in runtime-versions.json.\n'
        'FFmpeg library versions: ' + json.dumps(__import__('av').library_versions) + '\n',
        encoding='utf-8')
    (destination / 'runtime-versions.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')


if __name__ == '__main__':
    collect(sys.argv[1])
