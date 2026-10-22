# Build on macOS with scripts/build-macos-app.sh; no system Python is needed at runtime.
import os
import runpy
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

source = Path(SPECPATH)
project = source.parent
identity = os.environ.get('MACLINK_CODESIGN_IDENTITY') or None
version = runpy.run_path(str(source / 'app_runtime.py'))['VERSION']
data = collect_data_files('certifi') + [
    (str(source / 'maclink_icon.png'), '.'),
    (str(project / 'LICENSE.md'), 'legal'),
    (str(project / 'THIRD_PARTY_NOTICES.md'), 'legal'),
    (str(project / '.build' / 'maclink' / 'notices'), 'legal/python'),
]
a = Analysis(
    [str(source / 'menubar.py')],
    pathex=[str(source)],
    binaries=[],
    datas=data,
    hiddenimports=collect_submodules('aiortc') + collect_submodules('av') + [
        'AppKit', 'Foundation', 'Quartz', 'ApplicationServices', 'mss.darwin',
        'PIL.Image', 'aiohttp', 'certifi', 'ScreenCaptureKit', 'CoreMedia', 'enrollment',
    ],
    hookspath=[], hooksconfig={}, runtime_hooks=[], excludes=['tkinter'],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, [], exclude_binaries=True, name='MacLink',
    debug=False, bootloader_ignore_signals=False, strip=False, upx=False,
    console=False, argv_emulation=False, target_arch=None,
    codesign_identity=identity, entitlements_file=None,
)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name='MacLink')
app = BUNDLE(
    coll, name='MacLink.app',
    icon=str(project / '.build' / 'maclink' / 'MacLink.icns'),
    bundle_identifier='com.maclink.connector',
    info_plist={
        'CFBundleName': 'MacLink',
        'CFBundleDisplayName': 'MacLink Connector',
        'CFBundleLocalizations': ['ko', 'en'],
        'CFBundleDevelopmentRegion': 'en',
        'CFBundleShortVersionString': version,
        'CFBundleVersion': version,
        'LSUIElement': True,
        'LSMinimumSystemVersion': '13.0',
        'NSHighResolutionCapable': True,
        'NSScreenCaptureUsageDescription': 'Share your primary display and system audio with devices signed in to your MacLink account.',
        'NSAccessibilityUsageDescription': 'Allow keyboard and mouse control for MacLink sessions you authorize.',
    },
)
