"""Render localized documentation from native AppKit views without launching the app.

Run on macOS with the Connector's build environment:
  .build/maclink/venv/bin/python docs/images/generate_connector_previews.py

All states and the registration code are synthetic. This script creates no
window, starts no worker, reads no configuration and writes no preferences.
"""
from pathlib import Path
import json
import sys
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
CONNECTOR = ROOT / 'MacLink_Connector'
if not CONNECTOR.is_dir():
    CONNECTOR = ROOT / 'connector'
sys.path.insert(0, str(CONNECTOR))

import AppKit as A
import Foundation as F
import Quartz as Q
from PIL import Image, ImageDraw, ImageFont
import connector_ui as UI
from app_runtime import VERSION

OUT = Path(__file__).resolve().parent
SCALE = 2
MANIFEST = ROOT / 'MackLink_Web/lib/connector-installer-manifest.json'
if not MANIFEST.is_file():
    MANIFEST = ROOT / 'lib/connector-installer-manifest.json'
PUBLISHED_VERSION = json.loads(MANIFEST.read_text())['version']


def snapshot(*, configured=False, pending=False):
    value = UI.preview_snapshot()
    value.update(device='MacBook Pro · ' + ('미리보기' if UI.current_language() == 'ko' else 'UI preview'), configured=configured,
                 connection='서버 연결됨' if configured else '미리보기',
                 session='없음' if configured else '확인 안 함',
                 online=configured, running=configured,
                 screen=True if configured else None,
                 input=True if configured else None,
                 enabled={key: True for key in value['enabled']})
    if pending:
        value['enrollment'] = {'status': 'pending', 'verification_code': '123456',
                               'verification_url': 'https://www.maclink.cloud/connect-mac?request=' + 'a' * 24}
    return value


def capture(target, *, tab=0, configured=False, pending=False, bottom=False):
    panel = UI.ConnectorPanel(target, VERSION, 640)
    panel.view.setAppearance_(A.NSAppearance.appearanceNamed_(A.NSAppearanceNameAqua))
    panel.update(snapshot(configured=configured, pending=pending))
    panel.update_version({'status': 'current', 'latest': PUBLISHED_VERSION})
    panel.select_tab(tab)
    # Expand only this offscreen document, keeping the real width and control
    # geometry. Rendering a scrolled NSClipView directly as PDF can omit its
    # clipping and paint content over the header, so compose sections from the
    # complete, unscrolled native rendering instead.
    page_height = int(panel.pages[tab].frame().size.height)
    height = page_height + 130
    panel.view.setFrameSize_((panel.width, height))
    panel.scroll.setFrameSize_((388, page_height))
    panel.scroll.contentView().setBoundsOrigin_((0, 0))
    panel.pages[tab].scrollPoint_((0, 0))
    panel.scroll.reflectScrolledClipView_(panel.scroll.contentView())
    panel.view.layoutSubtreeIfNeeded()
    # Export native vector drawing and rasterize directly at 2x. This avoids
    # enlarging a low-resolution screenshot or inventing interface elements.
    pdf = panel.view.dataWithPDFInsideRect_(panel.view.bounds())
    representation = A.NSPDFImageRep.imageRepWithData_(pdf)
    width, height = int(representation.size().width), int(representation.size().height)
    bitmap = A.NSBitmapImageRep.alloc().initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bytesPerRow_bitsPerPixel_(
        None, width * SCALE, height * SCALE, 8, 4, True, False, A.NSDeviceRGBColorSpace, 0, 0)
    context = A.NSGraphicsContext.graphicsContextWithBitmapImageRep_(bitmap)
    A.NSGraphicsContext.saveGraphicsState()
    try:
        A.NSGraphicsContext.setCurrentContext_(context)
        Q.CGContextScaleCTM(context.CGContext(), SCALE, SCALE)
        representation.drawInRect_(((0, 0), (width, height)))
    finally:
        A.NSGraphicsContext.restoreGraphicsState()
    from io import BytesIO
    data = bitmap.representationUsingType_properties_(A.NSBitmapImageFileTypePNG, {})
    rendered = Image.open(BytesIO(bytes(data))).convert('RGB')
    if tab == 0:
        return rendered
    permissions = panel.buttons['screenPane'][0].superview().frame()
    offset = int(permissions.origin.y) if bottom else 0
    # End on complete cards, rather than leaving the next card's heading cut
    # off. Settings is an expanded documentation section, not a live window.
    content_height = page_height - offset if bottom else int(permissions.origin.y + permissions.size.height)
    section = Image.new('RGB', (width * SCALE, (content_height + 130) * SCALE), rendered.getpixel((0, 0)))
    section.paste(rendered.crop((0, 0, width * SCALE, 114 * SCALE)), (0, 0))
    section.paste(rendered.crop((0, (114 + offset) * SCALE, width * SCALE, (114 + offset + content_height) * SCALE)), (0, 114 * SCALE))
    return section


def gallery(name, title, panes, language='en'):
    margin, gap, top, bottom = 32, 32, 156, 32
    width = margin * 2 + sum(image.width for _, image in panes) + gap * (len(panes) - 1)
    height = top + max(image.height for _, image in panes) + bottom
    canvas = Image.new('RGB', (width, height), '#f1f5f3')
    draw = ImageDraw.Draw(canvas)
    font_path = '/System/Library/Fonts/AppleSDGothicNeo.ttc' if language == 'ko' else '/System/Library/Fonts/Supplemental/Arial.ttf'
    draw.text((margin, 20), f'MacLink {VERSION} · {title}', font=ImageFont.truetype(font_path, 30), fill='#204f40')
    note = ('UI 미리보기. 예시 상태이며 실제 계정·기기 키·권한·연결 정보는 읽지 않습니다.' if language == 'ko' else
            'UI preview. Example states only; no keys, accounts, permissions or connections are read.')
    draw.text((margin, 64), note,
              font=ImageFont.truetype(font_path, 20), fill='#546a60')
    x = margin
    for heading, image in panes:
        draw.text((x + 8, 114), heading, font=ImageFont.truetype(font_path, 24), fill='#204f40')
        canvas.paste(image, (x, top))
        x += image.width + gap
    destination = OUT / name
    canvas.save(destination, optimize=True)
    print(destination.relative_to(ROOT))


def main():
    A.NSApplication.sharedApplication()
    # Override language only in this process. Never call set_language(), which
    # would persist the user's preference.
    with patch('localization.current_language', return_value='en'), patch.object(UI, 'current_language', return_value='en'):
        target = F.NSObject.alloc().init()
        home_setup = capture(target)
        home_connected = capture(target, configured=True)
        registration = capture(target, tab=1, pending=True)
        settings_top = capture(target, tab=1, configured=True)
        settings_bottom = capture(target, tab=1, configured=True, bottom=True)
        gallery('connector-registration-en.png', 'Automatic registration',
                [('Connect with Google', home_setup), ('Approve in your browser · example code', registration)])
        gallery('connector-overview-en.png', 'Home and Settings',
                [('Home · example connected state', home_connected), ('Settings · account and connector', settings_top)])
        gallery('connector-settings-en.png', 'Settings',
                [('Account and connector', settings_top), ('Permissions, language and version', settings_bottom)])
    with patch('localization.current_language', return_value='ko'), patch.object(UI, 'current_language', return_value='ko'):
        target = F.NSObject.alloc().init()
        gallery('connector-registration-ko.png', '자동 등록',
                [('Google 계정으로 연결', capture(target)),
                 ('브라우저에서 승인 · 예시 확인 코드', capture(target, tab=1, pending=True))], 'ko')


if __name__ == '__main__':
    main()
