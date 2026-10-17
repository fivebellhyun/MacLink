"""Native presentation for the menu bar app; no worker or configuration I/O."""
from __future__ import annotations

from pathlib import Path

import AppKit as A
import ApplicationServices as C
import objc

from support import support_options
from localization import current_language, tr

CARD_CORNER_RADIUS = 14.0
SYMBOL_LEFT_INSET = 20.0


def _rounded_path(frame):
    bounds = A.NSInsetRect(frame, 0.5, 0.5)
    return A.NSBezierPath.bezierPathWithRoundedRect_xRadius_yRadius_(bounds, CARD_CORNER_RADIUS, CARD_CORNER_RADIUS)


class MacLinkPanelView(A.NSView):
    def isFlipped(self):
        return True

    def isOpaque(self):
        return False


class MacLinkGlassView(A.NSVisualEffectView):
    """Let AppKit composite the desktop backdrop and honor accessibility settings."""
    def isFlipped(self):
        return True


class MacLinkCardView(MacLinkPanelView):
    def drawRect_(self, rect):
        path = _rounded_path(self.bounds())
        # Retain a quiet reading surface while letting the native material show
        # through. Reduce Transparency uses an opaque card as well as AppKit's
        # own opaque replacement for the visual effect material.
        reduced = A.NSWorkspace.sharedWorkspace().accessibilityDisplayShouldReduceTransparency()
        A.NSColor.controlBackgroundColor().colorWithAlphaComponent_(1 if reduced else 0.78).setFill()
        path.fill()
        A.NSColor.separatorColor().colorWithAlphaComponent_(0.2).setStroke()
        path.setLineWidth_(1)
        path.stroke()


def _label(parent, text, frame, size=13, bold=False, secondary=False, lines=1):
    label = A.NSTextField.labelWithString_(tr(text))
    label.setFrame_(frame)
    weight = A.NSFontWeightSemibold if bold else A.NSFontWeightRegular
    label.setFont_(A.NSFont.systemFontOfSize_weight_(size, weight))
    label.setTextColor_(A.NSColor.secondaryLabelColor() if secondary else A.NSColor.labelColor())
    label.setMaximumNumberOfLines_(lines)
    label.setLineBreakMode_(A.NSLineBreakByTruncatingTail if lines == 1 else A.NSLineBreakByWordWrapping)
    label.setSelectable_(False)
    parent.addSubview_(label)
    return label


class MacLinkPaddedButtonCell(A.NSButtonCell):
    """Keep exactly 20pt of left content padding and retain the full hit area."""
    def imageRectForBounds_(self, bounds):
        image = objc.super(MacLinkPaddedButtonCell, self).imageRectForBounds_(bounds)
        if getattr(self, '_native_geometry', False) or self.image() is None or self.imagePosition() != A.NSImageLeft:
            return image
        left = max(0, image.origin.x - bounds.origin.x)
        delta = SYMBOL_LEFT_INSET - left
        return A.NSMakeRect(image.origin.x + delta, image.origin.y, image.size.width, image.size.height)

    def titleRectForBounds_(self, bounds):
        if getattr(self, '_native_geometry', False):
            return objc.super(MacLinkPaddedButtonCell, self).titleRectForBounds_(bounds)
        # Ask AppKit for both baseline rectangles, suppressing our image inset
        # if its title implementation calls imageRectForBounds: internally.
        self._native_geometry = True
        try:
            native = objc.super(MacLinkPaddedButtonCell, self)
            title = native.titleRectForBounds_(bounds)
            image = native.imageRectForBounds_(bounds)
        finally:
            self._native_geometry = False
        if self.image() is None or self.imagePosition() != A.NSImageLeft:
            return title
        left = max(0, image.origin.x - bounds.origin.x)
        delta = SYMBOL_LEFT_INSET - left
        return A.NSMakeRect(title.origin.x + delta, title.origin.y, max(0, title.size.width - delta), title.size.height)


class MacLinkRoundedButtonCell(MacLinkPaddedButtonCell):
    """Native NSButton tracking/content with the same 14pt shape as the cards."""
    def drawBezelWithFrame_inView_(self, frame, view):
        color = view.bezelColor() or A.NSColor.controlBackgroundColor()
        if not self.isEnabled():
            color = color.colorWithSystemEffect_(A.NSColorSystemEffectDisabled)
        elif self.isHighlighted():
            color = color.colorWithSystemEffect_(A.NSColorSystemEffectPressed)
        path = _rounded_path(frame)
        color.setFill()
        path.fill()
        A.NSColor.separatorColor().colorWithAlphaComponent_(0.2).setStroke()
        path.setLineWidth_(1)
        path.stroke()

    def drawFocusRingMaskWithFrame_inView_(self, frame, view):
        A.NSColor.blackColor().setFill()
        _rounded_path(frame).fill()

    def focusRingMaskBoundsForFrame_inView_(self, frame, view):
        return frame


def _button(parent, title, frame, target, action, *, primary=False, symbol=None, tooltip=None, rounded=False):
    button = A.NSButton.alloc().initWithFrame_(frame)
    if rounded or symbol:
        cell_class = MacLinkRoundedButtonCell if rounded else MacLinkPaddedButtonCell
        button.setCell_(cell_class.alloc().initTextCell_(''))
    button.setTitle_(tr(title))
    button.setFont_(A.NSFont.systemFontOfSize_weight_(13, A.NSFontWeightMedium))
    # FlexiblePush (RegularSquare) grows with its frame; Rounded stays at 28pt.
    button.setBezelStyle_(A.NSBezelStyleRegularSquare)
    button.setControlSize_(A.NSControlSizeLarge)
    button.setTarget_(target)
    button.setAction_(action)
    button.setAccessibilityLabel_(tr(title))
    button.setToolTip_(tr(tooltip or title))
    if primary:
        button.setBezelColor_(A.NSColor.systemBlueColor())
        button.setContentTintColor_(A.NSColor.whiteColor())
    if symbol:
        icon = A.NSImage.imageWithSystemSymbolName_accessibilityDescription_(symbol, None)
        if icon:
            button.setImage_(icon)
            button.setImagePosition_(A.NSImageLeft)
    parent.addSubview_(button)
    return button


def _card(parent, frame):
    card = MacLinkCardView.alloc().initWithFrame_(frame)
    parent.addSubview_(card)
    return card


def _trim_vertical_padding(control, factor):
    """Scale only unused vertical space, keeping the original row center."""
    frame = control.frame()
    bounds = control.bounds()
    cell = control.cell()
    content_height = max(cell.titleRectForBounds_(bounds).size.height,
                         cell.imageRectForBounds_(bounds).size.height)
    height = content_height + (frame.size.height - content_height) * factor
    control.setFrame_(A.NSMakeRect(frame.origin.x, frame.origin.y + (frame.size.height - height) / 2,
                                  frame.size.width, height))


def _text_ink_bottom(label):
    """Return the visible text bottom, including the selected language's glyphs."""
    width, height = label.frame().size
    path = C.CGPathCreateWithRect(A.NSMakeRect(0, 0, max(0, width - 4), height), None)
    setter = C.CTFramesetterCreateWithAttributedString(label.attributedStringValue())
    frame = C.CTFramesetterCreateFrame(setter, (0, 0), path, None)
    lines = C.CTFrameGetLines(frame)
    origins = C.CTFrameGetLineOrigins(frame, (0, len(lines)), None) if lines else ()
    bottoms = []
    for line, origin in zip(lines, origins):
        ink = C.CTLineGetImageBounds(line, None)
        if ink.size.height > 0:
            bottoms.append(origin.y + ink.origin.y)
    return label.frame().origin.y + height - min(bottoms) if bottoms else label.frame().origin.y + height


def _center_notice(label):
    """Center the visible CoreText glyph block, including fallback Korean fonts."""
    parent_height = label.superview().bounds().size.height
    width = label.frame().size.width
    height = min(parent_height, label.cell().cellSizeForBounds_(A.NSMakeRect(0, 0, width, 1000)).height)
    ink_center = height / 2
    if height > 0:
        # NSTextField's text container has a 2pt inset on either side. Its
        # typographic line box alone does not account for visible descenders.
        path = C.CGPathCreateWithRect(A.NSMakeRect(0, 0, max(0, width - 4), height), None)
        setter = C.CTFramesetterCreateWithAttributedString(label.attributedStringValue())
        frame = C.CTFramesetterCreateFrame(setter, (0, 0), path, None)
        lines = C.CTFrameGetLines(frame)
        origins = C.CTFrameGetLineOrigins(frame, (0, len(lines)), None) if lines else ()
        extents = []
        for line, origin in zip(lines, origins):
            ink = C.CTLineGetImageBounds(line, None)
            if ink.size.height > 0:
                extents.append((origin.y + ink.origin.y, origin.y + ink.origin.y + ink.size.height))
        if extents:
            # CoreText's baseline coordinates grow upward; the view is flipped.
            ink_center = height - (min(low for low, high in extents) + max(high for low, high in extents)) / 2
    label.setFrame_(A.NSMakeRect(18, parent_height / 2 - ink_center, width, height))


def _support_title(button, icon, title):
    """Keep the emoji and wrapped title inside one native, fully clickable tile."""
    paragraph = A.NSMutableParagraphStyle.alloc().init()
    paragraph.setAlignment_(A.NSTextAlignmentCenter)
    paragraph.setLineBreakMode_(A.NSLineBreakByWordWrapping)
    paragraph.setLineSpacing_(4)
    font = A.NSFont.systemFontOfSize_weight_(12, A.NSFontWeightSemibold)
    display_title = tr(title)
    words = display_title.split(' ')
    measure = lambda value: A.NSAttributedString.alloc().initWithString_attributes_(value, {A.NSFontAttributeName: font}).size().width
    if measure(display_title) > 96:
        breaks = [(' '.join(words[:index]), ' '.join(words[index:])) for index in range(1, len(words))]
        breaks = [(left, right) for left, right in breaks if max(measure(left), measure(right)) <= 96]
        if breaks:
            display_title = '\n'.join(min(breaks, key=lambda pair: abs(measure(pair[0]) - measure(pair[1]))))
    if '\n' not in display_title:
        display_title += '\n\u00a0'
    text = A.NSMutableAttributedString.alloc().initWithString_attributes_(icon + '\n' + display_title, {
        A.NSFontAttributeName: font,
        A.NSForegroundColorAttributeName: A.NSColor.labelColor(),
        A.NSParagraphStyleAttributeName: paragraph,
    })
    icon_length = len(icon.encode('utf-16-le')) // 2
    text.addAttribute_value_range_(A.NSFontAttributeName, A.NSFont.systemFontOfSize_(29), (0, icon_length))
    button.cell().setWraps_(True)
    button.cell().setLineBreakMode_(A.NSLineBreakByWordWrapping)
    button.setAttributedTitle_(text)


class ConnectorPanel:
    """Fixed-width cards inside a scroll view also fit shorter Mac displays."""
    width = 420

    def __init__(self, target, version, height=640):
        self.version = version
        self.height = max(440, min(640, float(height)))
        self.controller = A.NSViewController.alloc().init()
        self.view = MacLinkGlassView.alloc().initWithFrame_(((0, 0), (self.width, self.height)))
        self.view.setMaterial_(A.NSVisualEffectMaterialPopover)
        self.view.setBlendingMode_(A.NSVisualEffectBlendingModeBehindWindow)
        self.view.setState_(A.NSVisualEffectStateActive)
        self.controller.setView_(self.view)
        self.buttons = {}
        self.options = support_options()
        self._build_header(target, version)
        self.scroll = A.NSScrollView.alloc().initWithFrame_(((16, 114), (388, self.height - 130)))
        self.scroll.setBorderType_(A.NSNoBorder)
        self.scroll.setDrawsBackground_(False)
        self.scroll.setHasVerticalScroller_(True)
        self.scroll.setAutohidesScrollers_(True)
        self.scroll.setHasHorizontalScroller_(False)
        self.view.addSubview_(self.scroll)
        self.pages = [MacLinkPanelView.alloc().initWithFrame_(((0, 0), (388, height))) for height in (512, 892, 496)]
        self._build_home(self.pages[0], target)
        self._build_settings(self.pages[1], target)
        self._build_support(self.pages[2], target)
        self.select_tab(0)

    def _build_header(self, target, version):
        image = A.NSImage.alloc().initWithContentsOfFile_(str(Path(__file__).with_name('maclink_icon.png')))
        if image is None:
            image = A.NSImage.imageNamed_(A.NSImageNameApplicationIcon)
        image_view = A.NSImageView.alloc().initWithFrame_(((20, 20), (24, 24)))
        image_view.setImage_(image)
        image_view.setAccessibilityLabel_(tr('MacLink 아이콘'))
        image_view.setImageScaling_(A.NSImageScaleProportionallyUpOrDown)
        self.view.addSubview_(image_view)
        _label(self.view, 'MacLink', ((54, 20), (240, 26)), 18, bold=True)
        version_label = _label(self.view, 'v' + version, ((320, 23), (80, 20)), 11, secondary=True)
        version_label.setAlignment_(A.NSTextAlignmentRight)
        self.tabs = A.NSSegmentedControl.alloc().initWithFrame_(((16, 58), (388, 40)))
        self.tabs.setControlSize_(A.NSControlSizeLarge)
        self.tabs.setSegmentCount_(3)
        for index, title in enumerate(('홈', '설정', '후원')):
            self.tabs.setLabel_forSegment_(tr(title), index)
            self.tabs.setWidth_forSegment_(126, index)
        self.tabs.setSelectedSegment_(0)
        self.tabs.setTarget_(target)
        self.tabs.setAction_('panelTab:')
        self.tabs.setAccessibilityLabel_(tr('MacLink 화면 선택'))
        self.tabs.setSegmentStyle_(A.NSSegmentStyleRounded)
        self.view.addSubview_(self.tabs)

    def _build_home(self, page, target):
        connection = _card(page, ((0, 0), (388, 144)))
        _label(connection, '서버 연결', ((18, 16), (280, 18)), 12, bold=True, secondary=True)
        self.connection = _label(connection, '확인 중', ((18, 42), (350, 33)), 24, bold=True)
        self.device = _label(connection, '기기 키를 가져와 연결하세요', ((18, 82), (350, 20)), 13)
        self.session = _label(connection, '세션: 없음', ((18, 111), (350, 18)), 12, secondary=True)

        permissions = _card(page, ((0, 156), (388, 128)))
        _label(permissions, '접근 권한', ((18, 15), (350, 19)), 12, bold=True, secondary=True)
        _label(permissions, '화면 기록', ((18, 47), (150, 20)), 13)
        _label(permissions, '기기 제어', ((18, 82), (150, 20)), 13)
        self.screen = _label(permissions, '확인 중', ((206, 47), (162, 20)), 13, bold=True)
        self.input = _label(permissions, '확인 중', ((206, 82), (162, 20)), 13, bold=True)
        self.screen.setAlignment_(A.NSTextAlignmentRight)
        self.input.setAlignment_(A.NSTextAlignmentRight)

        self.buttons['site'] = [_button(page, 'MacLink 웹사이트 열기', ((0, 300), (388, 48)), target, 'openSite:', primary=True, symbol='arrow.up.right.square', rounded=True)]
        _trim_vertical_padding(self.buttons['site'][0], 0.70)
        self.home_start = _button(page, '커넥터 시작', ((0, 364), (188, 48)), target, 'startWorker:', symbol='play.fill', rounded=True)
        self.buttons['stop'] = [_button(page, '연결 중지', ((200, 364), (188, 48)), target, 'stopWorker:', symbol='stop.fill', rounded=True)]
        notice = _card(page, ((0, 428), (388, 68)))
        self.notice = _label(notice, '기기 키와 권한은 설정에서 관리할 수 있습니다.', ((18, 15), (352, 40)), 12, secondary=True, lines=2)

    def _build_settings(self, page, target):
        setup = _card(page, ((0, 0), (388, 140)))
        _label(setup, '이 Mac 연결하기', ((18, 15), (352, 22)), 15, bold=True)
        _label(setup, '웹에서 받은 기기 키로 연결을 설정하세요.', ((18, 42), (352, 20)), 12, secondary=True)
        self.buttons['import'] = [_button(setup, '기기 키 가져오기…', ((16, 80), (218, 48)), target, 'importKey:', symbol='square.and.arrow.down')]
        self.buttons['log'] = [_button(setup, '로그 열기', ((246, 80), (126, 48)), target, 'openLog:', symbol='doc.text')]

        controls = _card(page, ((0, 156), (388, 176)))
        _label(controls, '커넥터', ((18, 15), (352, 20)), 15, bold=True)
        self.buttons['start'] = [_button(controls, '시작', ((16, 52), (110, 48)), target, 'startWorker:', symbol='play.fill')]
        self.buttons['stop'].append(_button(controls, '중지', ((138, 52), (110, 48)), target, 'stopWorker:', symbol='stop.fill'))
        self.buttons['restart'] = [_button(controls, '다시 시작', ((260, 52), (112, 48)), target, 'restartWorker:', symbol='arrow.clockwise')]
        for button in (self.buttons['start'][0], self.buttons['stop'][-1], self.buttons['restart'][0]):
            _trim_vertical_padding(button, 0.95)
        login_row = _card(controls, ((16, 116), (356, 48)))
        self.login = A.NSButton.alloc().initWithFrame_(((12, 0), (332, 48)))
        self.login.setButtonType_(A.NSSwitchButton)
        self.login.setTitle_(tr('로그인할 때 MacLink 시작'))
        self.login.setControlSize_(A.NSControlSizeLarge)
        self.login.setFont_(A.NSFont.systemFontOfSize_(13))
        self.login.setTarget_(target)
        self.login.setAction_('toggleLogin:')
        self.login.setAccessibilityLabel_(tr('로그인할 때 MacLink 시작'))
        login_row.addSubview_(self.login)
        language = _card(page, ((0, 508), (388, 112)))
        _label(language, '언어 설정', ((18, 16), (352, 23)), 15, bold=True)
        _label(language, '표시 언어', ((18, 66), (126, 20)), 13)
        self.language = A.NSPopUpButton.alloc().initWithFrame_pullsDown_(((156, 52), (216, 48)), False)
        self.language.setBezelStyle_(A.NSBezelStyleRegularSquare)
        self.language.setControlSize_(A.NSControlSizeLarge)
        self.language.addItemsWithTitles_(['한국어', 'English'])
        for index in range(2):
            self.language.itemAtIndex_(index).setTag_(index)
        self.language.selectItemAtIndex_(0 if current_language() == 'ko' else 1)
        self.language.setTarget_(target)
        self.language.setAction_('changeLanguage:')
        self.language.setAccessibilityLabel_(tr('표시 언어'))
        self.language.sizeToFit()
        language_width = self.language.frame().size.width + 8
        self.language.setFrame_(A.NSMakeRect(language.bounds().size.width - 16 - language_width, 52, language_width, 48))
        self.language.setAutoresizingMask_(A.NSViewMinXMargin)
        _trim_vertical_padding(self.language, 0.95)
        language.addSubview_(self.language)

        permissions = _card(page, ((0, 348), (388, 144)))
        _label(permissions, 'macOS 권한 설정', ((18, 15), (352, 20)), 15, bold=True)
        self.buttons['screenPane'] = [_button(permissions, '화면 기록', ((16, 54), (172, 48)), target, 'openScreen:', symbol='rectangle.on.rectangle', tooltip='시스템 설정에서 화면 기록 권한 열기')]
        self.buttons['inputPane'] = [_button(permissions, '기기 제어', ((200, 54), (172, 48)), target, 'openInput:', symbol='cursorarrow', tooltip='시스템 설정의 손쉬운 사용에서 기기 제어 권한 열기')]
        _label(permissions, '시스템 설정에서 이 MacLink 앱을 허용해 주세요.', ((18, 114), (352, 18)), 11, secondary=True)
        version = _card(page, ((0, 636), (388, 176)))
        _label(version, '버전 확인', ((18, 15), (352, 20)), 15, bold=True)
        _label(version, tr('현재 버전: {version}').format(version=self.version), ((18, 47), (352, 20)), 13)
        self.version_status = _label(version, '버튼을 눌러 최신 버전을 확인하세요.', ((18, 77), (352, 30)), 11, secondary=True, lines=2)
        self.update_button = _button(version, '최신 버전 확인', ((16, 116), (356, 48)), target, 'checkVersion:', symbol='arrow.clockwise')

        self.buttons['quit'] = [_button(page, 'MacLink 종료', ((0, 828), (388, 48)), target, 'quitApp:', symbol='power', rounded=True)]
        _trim_vertical_padding(self.buttons['quit'][0], 0.70)

    def update_version(self, snapshot, enabled=True):
        status = snapshot.get('status')
        if status == 'available':
            message = tr('새 버전 v{version}이 있습니다.').format(version=snapshot['latest'])
        else:
            message = tr({
                'idle': '버튼을 눌러 최신 버전을 확인하세요.',
                'checking': '최신 버전 확인 중…',
                'current': '최신 버전입니다.',
                'unpublished': '공개된 릴리스를 찾을 수 없습니다.',
                'failed': '버전 확인에 실패했습니다. 다시 시도해 주세요.',
            }.get(status, '버전 확인에 실패했습니다. 다시 시도해 주세요.'))
        self.version_status.setStringValue_(message)
        self.update_button.setTitle_(tr('확인 중' if status == 'checking' else '최신 버전 확인'))
        self.update_button.setEnabled_(enabled and status != 'checking')

    def _build_support(self, page, target):
        _label(page, 'MacLink에 힘을 보태 주세요', ((4, 7), (380, 29)), 21, bold=True)
        _label(page, '작은 응원이 다음 연결을 만드는 힘이 됩니다.', ((4, 45), (380, 36)), 12, secondary=True, lines=2)
        self.donation_buttons = []
        for index, option in enumerate(self.options):
            button = _button(page, option['label'], ((2 + index * 132, 96), (120, 120)), target, 'supportDonation:', rounded=True)
            _support_title(button, option['icon'], option['label'])
            button.setTag_(index)
            self.donation_buttons.append(button)
        contribution = _card(page, ((0, 236), (388, 188)))
        _label(contribution, '함께 만드는 MacLink', ((18, 16), (352, 23)), 16, bold=True)
        description = _label(contribution, '코드, 디자인, 번역으로 MacLink를 함께 만들어 주세요.\n여러분의 아이디어와 재능을 GitHub 오픈소스에 보태 주세요.', ((18, 52), (352, 64)), 13, secondary=True, lines=4)
        description.setFrameSize_((352, description.cell().cellSizeForBounds_(A.NSMakeRect(0, 0, 352, 1000)).height))
        self.github = _button(contribution, 'GitHub 저장소 열기', ((16, 128), (356, 48)), target, 'openGitHub:', primary=True, symbol='arrow.up.right.square', rounded=True)
        _trim_vertical_padding(self.github, 0.90)
        previous = self.github.frame()
        bottom_padding = contribution.bounds().size.height - previous.origin.y - previous.size.height
        _trim_vertical_padding(self.github, 0.70)
        text_bottom = _text_ink_bottom(description)
        self.github.setFrameOrigin_((previous.origin.x, text_bottom + (previous.origin.y - text_bottom) / 2))
        contribution.setFrameSize_((388, self.github.frame().origin.y + self.github.frame().size.height + bottom_padding))
        self.github.setToolTip_(tr('GitHub 저장소 열기') + ' · https://github.com/fivebellhyun/MacLink')
        _label(page, 'PayPal 후원 · 준비 중\n지금은 마음만 감사히 받고 있어요.', ((4, contribution.frame().origin.y + contribution.frame().size.height + 16), (380, 40)), 12, secondary=True, lines=2)

    def select_tab(self, index):
        index = max(0, min(len(self.pages) - 1, int(index)))
        self.tabs.setSelectedSegment_(index)
        self.scroll.setDocumentView_(self.pages[index])
        self.pages[index].scrollPoint_((0, 0))

    def update(self, snapshot):
        self.connection.setStringValue_(tr(snapshot['connection']))
        self.connection.setToolTip_(tr(snapshot['connection']))
        self.connection.setTextColor_(A.NSColor.systemGreenColor() if snapshot.get('online') else A.NSColor.labelColor())
        self.device.setStringValue_(snapshot['device'])
        self.device.setToolTip_(snapshot['device'])
        self.session.setStringValue_(tr('세션: ') + tr(snapshot['session']))
        for label, title, value in ((self.screen, '화면 기록', snapshot['screen']), (self.input, '기기 제어', snapshot['input'])):
            text = '확인 안 함' if value is None else '허용됨' if value else '권한 필요'
            label.setStringValue_(tr(text))
            label.setAccessibilityLabel_(tr(title) + ': ' + tr(text))
            label.setTextColor_(A.NSColor.secondaryLabelColor() if value is None else A.NSColor.systemGreenColor() if value else A.NSColor.systemOrangeColor())
        enabled = snapshot['enabled']
        for key, buttons in self.buttons.items():
            for button in buttons:
                button.setEnabled_(bool(enabled.get(key, True)))
        restarting = snapshot.get('running', False)
        self.home_start.setTitle_(tr('다시 연결' if restarting else '커넥터 시작'))
        self.home_start.setAction_('restartWorker:' if restarting else 'startWorker:')
        self.home_start.setEnabled_(bool(enabled.get('restart' if restarting else 'start', False)))
        self.home_start.setAccessibilityLabel_(self.home_start.title())
        self.home_start.setToolTip_(self.home_start.title())
        self.login.setState_(A.NSControlStateValueOn if snapshot.get('login') else A.NSControlStateValueOff)
        self.login.setEnabled_(not snapshot.get('preview', False))
        if snapshot.get('preview'):
            notice = 'UI 미리보기입니다.\n기기 키와 실제 권한 상태는 읽지 않습니다.'
        elif not snapshot['screen'] or not snapshot['input']:
            notice = '권한 설정이 필요합니다.\n설정에서 화면 기록과 기기 제어를 허용해 주세요.'
        elif snapshot.get('online'):
            notice = '서버에 연결되어 있습니다.\n웹에서 이 Mac을 선택해 연결을 요청하세요.'
        else:
            notice = '기기 키와 서버 연결 상태를 확인해 주세요.\n연결 설정과 로그는 설정 탭에서 볼 수 있습니다.'
        self.notice.setStringValue_(tr(notice))
        _center_notice(self.notice)


def preview_snapshot():
    """Preview never reads device keys, starts a worker or claims real permissions."""
    return {'connection': tr('미리보기'), 'device': tr('MacLink 메뉴 막대 앱'), 'session': tr('확인 안 함'),
            'screen': None, 'input': None, 'online': False, 'running': False, 'login': False,
            'preview': True, 'enabled': {key: False for key in
                ('site', 'start', 'stop', 'restart', 'import', 'log', 'screenPane', 'inputPane')}}
