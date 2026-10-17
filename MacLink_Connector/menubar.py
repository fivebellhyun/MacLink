#!/usr/bin/env python3
"""MacLink.app: a native, user-visible macOS menu bar connector.

The frozen executable has two roles: AppKit UI and its owned --worker child.
Neither role opens an inbound socket or accepts local remote-control commands.
"""
import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

from localization import LANGUAGES, current_language, set_language, tr

from app_runtime import (APP_ROOT, CONFIG_PATH, LOG_PATH, STATUS_PATH, VERSION, WEBSITE_URL,
                         InstanceLock, StatusPublisher, WorkerController,
                         atomic_json, load_config, login_enabled, read_status,
                         save_imported_config, set_login_enabled, worker_running)


_MENU_ITEMS = (
    ('name', 'MacLink ' + VERSION, None),
    ('connection', '연결: 설정 필요', None),
    ('session', '세션: 없음', None),
    ('screen', '화면 기록: 확인 중', None),
    ('input', '기기 제어: 확인 중', None),
    (None, None, None),
    ('import', '기기 키 가져오기…', 'importKey:'),
    ('site', 'MacLink 웹사이트 열기', 'openSite:'),
    (None, None, None),
    ('start', '커넥터 시작', 'startWorker:'),
    ('stop', '연결 중지', 'stopWorker:'),
    ('restart', '다시 시작', 'restartWorker:'),
    ('login', '로그인 시 실행', 'toggleLogin:'),
    (None, None, None),
    ('screenPane', '화면 기록 설정…', 'openScreen:'),
    ('inputPane', '기기 제어 설정…', 'openInput:'),
    ('log', '로그 열기', 'openLog:'),
    (None, None, None),
    ('quit', 'MacLink 종료', 'quitApp:'),
)


def self_test():
    import AppKit
    import Quartz
    import ApplicationServices
    import aiortc
    import av
    import aiohttp
    import mss
    import mss.darwin
    import PIL.Image
    import certifi
    registered = run_app(register_only=True)
    print(json.dumps({'delegate': registered, 'native_ui': 'ok', 'version': VERSION, 'executable': sys.executable,
                      'frozen': bool(getattr(sys, 'frozen', False)),
                      'screen': bool(Quartz.CGPreflightScreenCaptureAccess()),
                      'accessibility': bool(ApplicationServices.AXIsProcessTrusted()),
                      'dependencies': 'ok', 'language': current_language(),
                      'languages': list(LANGUAGES), 'localization': 'ok'}), flush=True)


def run_worker(config_path):
    from maclink import main
    try:
        asyncio.run(main(config_path, status_path=Path(config_path).parent / 'status.json'))
        return 0
    except KeyboardInterrupt:
        return 0
    except BaseException as error:
        # No exception strings: some third-party exceptions contain URLs/credentials.
        print('MacLink worker stopped: ' + type(error).__name__, flush=True)
        try:
            StatusPublisher(Path(config_path).parent / 'status.json').publish(
                connection='error', session='idle', error='startup')
        except Exception:
            pass
        return 1


def run_app(register_only=False, show_panel=False, preview_ui=False):
    import AppKit as A
    import objc
    import Foundation as F
    import Quartz as Q
    import ApplicationServices as AX
    from connector_ui import ConnectorPanel, preview_snapshot
    from support import SUPPORT_MESSAGE
    from update import UpdateChecker

    app_lock = None

    class MacLinkDelegate(F.NSObject):
        def applicationDidFinishLaunching_(self, notification):
            self.controller = WorkerController()
            self.config = None
            self.pendingConfig = None
            self.quitting = False
            self.lastError = None
            self.preview = preview_ui
            self.updateChecker = UpdateChecker(VERSION)
            self.statusItem = A.NSStatusBar.systemStatusBar().statusItemWithLength_(A.NSVariableStatusItemLength)
            self.statusItem.button().setTitle_('ML')
            self.statusItem.button().setToolTip_('MacLink ' + VERSION)
            self.menu = A.NSMenu.alloc().init()
            self.items = {}
            for key, title, action in _MENU_ITEMS:
                if key is None:
                    self.menu.addItem_(A.NSMenuItem.separatorItem())
                    continue
                item = A.NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(tr(title), action, 'q' if key == 'quit' else '')
                if action:
                    item.setTarget_(self)
                else:
                    item.setEnabled_(False)
                self.items[key] = item
                self.menu.addItem_(item)
            self.menu.setAutoenablesItems_(False)
            button = self.statusItem.button()
            button.setTarget_(self)
            button.setAction_('statusClicked:')
            button.sendActionOn_(A.NSEventMaskLeftMouseUp | A.NSEventMaskRightMouseUp)
            screen = A.NSScreen.mainScreen()
            height = min(640, screen.visibleFrame().size.height - 80) if screen else 640
            self.panel = ConnectorPanel(self, VERSION, height)
            self.popover = A.NSPopover.alloc().init()
            self.popover.setBehavior_(A.NSPopoverBehaviorTransient)
            self.popover.setContentSize_((self.panel.width, self.panel.height))
            self.popover.setContentViewController_(self.panel.controller)
            self.timer = F.NSTimer.scheduledTimerWithTimeInterval_target_selector_userInfo_repeats_(
                1, self, 'refresh:', None, True)
            if not self.preview and CONFIG_PATH.exists():
                try:
                    self.config = load_config()
                    self.controller.start()
                except Exception as error:
                    self.lastError = str(error) if isinstance(error, (ValueError, RuntimeError)) else '커넥터를 시작하지 못했습니다. 로그를 확인해 주세요.'
            self.refresh_(None)
            first_dashboard = not self.preview and not (APP_ROOT / 'ui-seen.json').exists()
            if show_panel or self.preview or first_dashboard:
                self.showPanel_(None)
            if first_dashboard:
                try:
                    atomic_json(APP_ROOT / 'ui-seen.json', {'dashboard': 1})
                except OSError:
                    pass

        def statusClicked_(self, sender):
            event = A.NSApp.currentEvent()
            if event and (event.type() == A.NSEventTypeRightMouseUp or event.modifierFlags() & A.NSEventModifierFlagControl):
                self.popover.close()
                self.statusItem.popUpStatusItemMenu_(self.menu)
            elif self.popover.isShown():
                self.popover.close()
            else:
                self.showPanel_(sender)

        def showPanel_(self, sender):
            A.NSApp.activateIgnoringOtherApps_(True)
            button = self.statusItem.button()
            self.popover.showRelativeToRect_ofView_preferredEdge_(button.bounds(), button, A.NSMinYEdge)
            if self.panel.view.window():
                self.panel.view.window().setTitle_('MacLink')

        def applicationShouldHandleReopen_hasVisibleWindows_(self, app, visible):
            self.showPanel_(None)
            return True

        def panelTab_(self, sender):
            self.panel.select_tab(sender.selectedSegment())

        @objc.python_method
        def renderPresentation(self, snapshot):
            # Retain source keys, permissions and enabled states. A language
            # change can redraw this cache without touching the worker or config.
            self.presentation = snapshot
            for key, title, action in _MENU_ITEMS:
                if key and action:
                    self.items[key].setTitle_(tr(title))
            if snapshot.get('preview'):
                view = preview_snapshot()
                self.items['connection'].setTitle_(tr('MacLink UI 미리보기'))
                self.items['session'].setTitle_(tr('세션: 없음'))
                self.items['screen'].setTitle_(tr('화면 기록: 확인 안 함'))
                self.items['input'].setTitle_(tr('기기 제어: 확인 안 함'))
            else:
                connection = tr(snapshot['connection'])
                session = ' · '.join(tr(part) for part in snapshot['session_parts'])
                view = {**snapshot, 'connection': connection, 'session': session}
                if snapshot['device_placeholder']:
                    view['device'] = tr(snapshot['device'])
                self.items['name'].setTitle_(snapshot['menu_name'])
                self.items['connection'].setTitle_(tr('연결: ') + connection)
                self.items['session'].setTitle_(tr('세션: ') + session)
                self.items['screen'].setTitle_(tr('화면 기록: ') + tr('허용됨' if snapshot['screen'] else '권한 필요'))
                self.items['input'].setTitle_(tr('기기 제어: ') + tr('허용됨' if snapshot['input'] else '권한 필요'))
                self.statusItem.button().setToolTip_('MacLink · ' + connection + '\n' + tr('세션: ') + session)
            self.panel.update(view)
            self.panel.update_version(self.updateChecker.snapshot(), enabled=not self.preview)

        def checkVersion_(self, sender):
            if self.preview or self.quitting:
                return
            self.updateChecker.start()
            self.panel.update_version(self.updateChecker.snapshot())

        def changeLanguage_(self, sender):
            index = int(sender.indexOfSelectedItem())
            if index not in (0, 1):
                return
            try:
                # Only an explicit selection writes this app-specific key.
                set_language(LANGUAGES[index])
            except Exception:
                self.alert('언어를 변경할 수 없습니다', '표시 언어 설정을 저장하지 못했습니다.')
                return
            selected_tab = self.panel.tabs.selectedSegment()
            height = self.panel.height
            visible = self.popover.isShown()
            self.panel = ConnectorPanel(self, VERSION, height)
            self.panel.select_tab(selected_tab)
            self.popover.setContentSize_((self.panel.width, self.panel.height))
            self.popover.setContentViewController_(self.panel.controller)
            self.renderPresentation(self.presentation)
            if visible and not self.popover.isShown():
                self.showPanel_(None)

        def supportDonation_(self, sender):
            self.popover.close()
            self.alert('마음만 감사히 받겠습니다', SUPPORT_MESSAGE)
            self.showPanel_(None)

        @objc.python_method
        def alert(self, title, message, confirm=False):
            self.popover.close()
            A.NSApp.activateIgnoringOtherApps_(True)
            dialog = A.NSAlert.alloc().init()
            dialog.setMessageText_(tr(title))
            dialog.setInformativeText_(tr(message))
            dialog.addButtonWithTitle_(tr('확인' if not confirm else '가져오기'))
            if confirm:
                dialog.addButtonWithTitle_(tr('취소'))
            return dialog.runModal() == A.NSAlertFirstButtonReturn

        def refresh_(self, timer):
            if self.preview:
                for key, item in self.items.items():
                    if key not in ('name', 'connection', 'session', 'screen', 'input', 'quit'):
                        item.setEnabled_(False)
                self.renderPresentation({'preview': True})
                return
            try:
                self.controller.tick()
                if self.pendingConfig is not None and self.controller.process is None:
                    self.config = save_imported_config(self.pendingConfig)
                    self.pendingConfig = None
                    self.controller.start()
                    self.lastError = None
            except Exception:
                self.pendingConfig = None
                self.lastError = '커넥터를 시작하지 못했습니다. 로그를 확인해 주세요.'
            if self.quitting:
                if self.controller.process is None:
                    A.NSApp.replyToApplicationShouldTerminate_(True)
                return
            process = self.controller.process
            running = process is not None and process.poll() is None
            status = read_status(pid=process.pid if running else self.controller.last_pid) if self.controller.last_pid else None
            external = not running and worker_running()
            permissions = (bool(Q.CGPreflightScreenCaptureAccess()), bool(AX.AXIsProcessTrusted()))
            connection = '설정 필요' if not self.config else '중지됨'
            if external:
                connection = '기존 커넥터 실행 중'
            elif running:
                connection = {'starting': '시작 중', 'connecting': '연결 중', 'online': '서버 연결됨',
                              'reconnecting': '재연결 중', 'stopped': '중지 중', 'error': '오류'}.get(
                                  status['connection'] if status else 'starting', '연결 중')
                if status:
                    permissions = status['screen'], status['accessibility']
            elif status and status['error'] == 'revoked':
                connection = '기기 키 취소됨 — 새 키 가져오기'
            elif self.controller.last_exit not in (None, 0):
                connection = '오류 — 로그 확인'
            if self.lastError:
                connection = '시작 실패 — 로그 확인'
            if not running:
                status = None
            session = {'idle': '없음', 'pending': '승인 대기', 'approved': '준비 중', 'active': '접속 중', 'paused': '일시 중지'}.get(status['session'] if status else 'idle', '없음')
            session_parts = [session]
            if status and status['mode']:
                session_parts.append('화면 보기' if status['mode'] == 'view' else '원격 제어')
            busy = self.controller.stop_deadline is not None or self.pendingConfig is not None
            self.items['start'].setEnabled_(bool(self.config) and not running and not external and not busy)
            self.items['stop'].setEnabled_(running and not busy)
            self.items['restart'].setEnabled_(running and not busy)
            self.items['import'].setEnabled_(not busy and not external)
            self.items['site'].setEnabled_(True)
            self.items['login'].setState_(A.NSControlStateValueOn if login_enabled() else A.NSControlStateValueOff)
            self.items['log'].setEnabled_(LOG_PATH.exists())
            self.statusItem.button().setTitle_('ML ●' if status and status['session'] == 'active' else 'ML')
            self.renderPresentation({
                'connection': connection,
                'device': self.config['name'] if self.config else '기기 키를 가져와 연결하세요',
                'device_placeholder': not bool(self.config),
                'menu_name': 'MacLink · ' + (self.config['name'] if self.config else VERSION),
                'session_parts': tuple(session_parts), 'screen': permissions[0], 'input': permissions[1],
                'online': bool(status and status['connection'] == 'online'), 'running': running,
                'login': self.items['login'].state() == A.NSControlStateValueOn,
                'enabled': {key: item.isEnabled() for key, item in self.items.items()},
            })

        def importKey_(self, sender):
            if self.preview:
                return
            self.popover.close()
            panel = A.NSOpenPanel.openPanel()
            panel.setCanChooseFiles_(True)
            panel.setCanChooseDirectories_(False)
            panel.setAllowsMultipleSelection_(False)
            panel.setAllowedFileTypes_(['json'])
            panel.setTitle_(tr('기기 키 가져오기'))
            panel.setPrompt_(tr('가져오기'))
            panel.setMessage_(tr('웹사이트에서 다운로드한 maclink-config.json을 선택하세요.'))
            A.NSApp.activateIgnoringOtherApps_(True)
            if panel.runModal() != A.NSModalResponseOK:
                return
            try:
                config = load_config(Path(panel.URL().path()))
            except Exception as error:
                self.alert('기기 키를 가져올 수 없습니다', str(error) if isinstance(error, ValueError) else '읽을 수 있는 MacLink JSON 파일을 선택하세요.')
                return
            details = tr('웹사이트: {site}\n기기: {name}\n\n이 웹사이트에 등록한 본인의 기기인지 확인하세요. 기존 키가 있으면 교체되며 현재 원격 세션은 종료됩니다. 일회용 초대는 Mac에서 연결 승인을 요청합니다.').format(site=config['site'], name=config['name'])
            if not self.alert('이 기기 키를 사용하시겠습니까?', details, confirm=True):
                return
            self.pendingConfig = config
            self.controller.stop()
            self.refresh_(None)

        def openGitHub_(self, sender):
            if not self.preview:
                A.NSWorkspace.sharedWorkspace().openURL_(F.NSURL.URLWithString_('https://github.com/fivebellhyun/MacLink'))

        def openSite_(self, sender):
            if not self.preview:
                A.NSWorkspace.sharedWorkspace().openURL_(F.NSURL.URLWithString_(WEBSITE_URL))

        def startWorker_(self, sender):
            if self.preview:
                return
            try:
                self.controller.start()
                self.lastError = None
            except Exception as error:
                self.alert('커넥터를 시작할 수 없습니다', str(error) if isinstance(error, (RuntimeError, ValueError)) else '연결 로그를 확인해 주세요.')
            self.refresh_(None)

        def stopWorker_(self, sender):
            if self.preview:
                return
            self.controller.stop()
            self.refresh_(None)

        def restartWorker_(self, sender):
            if self.preview:
                return
            self.controller.stop(restart=True)
            self.refresh_(None)

        def toggleLogin_(self, sender):
            if self.preview:
                return
            try:
                set_login_enabled(not login_enabled())
            except Exception:
                self.alert('로그인 실행 설정 실패', '로그인 항목을 변경하지 못했습니다. 시스템 설정 → 일반 → 로그인 항목을 확인하세요.')
            self.refresh_(None)

        def openScreen_(self, sender):
            if self.preview:
                return
            Q.CGRequestScreenCaptureAccess()
            A.NSWorkspace.sharedWorkspace().openURL_(F.NSURL.URLWithString_('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'))

        def openInput_(self, sender):
            if self.preview:
                return
            AX.AXIsProcessTrustedWithOptions({AX.kAXTrustedCheckOptionPrompt: True})
            A.NSWorkspace.sharedWorkspace().openURL_(F.NSURL.URLWithString_('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'))

        def openLog_(self, sender):
            if self.preview:
                return
            A.NSWorkspace.sharedWorkspace().openURL_(F.NSURL.fileURLWithPath_(str(LOG_PATH)))

        def quitApp_(self, sender):
            A.NSApp.terminate_(None)

        def applicationShouldTerminate_(self, sender):
            self.quitting = True
            self.pendingConfig = None
            if self.preview:
                return A.NSTerminateNow
            self.controller.stop(restart=False)
            return A.NSTerminateLater if self.controller.process is not None else A.NSTerminateNow

        def applicationWillTerminate_(self, notification):
            self.timer.invalidate()
            if app_lock:
                app_lock.release()

    if register_only:
        selectors = ('applicationDidFinishLaunching:', 'refresh:', 'importKey:', 'startWorker:',
                     'stopWorker:', 'restartWorker:', 'toggleLogin:', 'openSite:', 'openScreen:',
                     'openInput:', 'openLog:', 'quitApp:', 'applicationShouldTerminate:',
                     'applicationWillTerminate:', 'statusClicked:', 'showPanel:', 'panelTab:',
                     'supportDonation:', 'changeLanguage:', 'openGitHub:', 'checkVersion:',
                     'applicationShouldHandleReopen:hasVisibleWindows:')
        if not all(MacLinkDelegate.instancesRespondToSelector_(name) for name in selectors):
            raise RuntimeError('The native menu delegate is missing a required action.')
        # Construct native controls on the main thread, with no config, locks,
        # windows, permission prompts, worker or event loop.
        A.NSApplication.sharedApplication()
        target = MacLinkDelegate.alloc().init()
        panel = ConnectorPanel(target, VERSION, 640)
        panel.update(preview_snapshot())
        panel.update_version({'status': 'current', 'latest': VERSION})
        if panel.version_status.stringValue() != tr('최신 버전입니다.'):
            raise RuntimeError('The native version check card is unavailable.')
        for index in range(3):
            panel.select_tab(index)
        if len(panel.donation_buttons) != 3 or not all(button.isEnabled() for button in panel.donation_buttons):
            raise RuntimeError('The native support buttons are missing.')
        panel.update({**preview_snapshot(), 'preview': False, 'online': True,
                      'connection': '서버 연결됨', 'screen': False, 'input': False})
        if (panel.notice.stringValue() != tr('권한 설정이 필요합니다.\n설정에서 화면 기록과 기기 제어를 허용해 주세요.')
                or panel.input.stringValue() != tr('권한 필요')):
            raise RuntimeError('The native dashboard must show missing permissions independently of server status.')
        if tr('홈', language='en') != 'Home' or tr('홈', language='ko') != '홈':
            raise RuntimeError('The native localization catalog is unavailable.')
        return 'ok'

    if not preview_ui:
        app_lock = InstanceLock(APP_ROOT / 'menubar.lock')
        if not app_lock.acquire():
            return 0
    app = A.NSApplication.sharedApplication()
    app.setActivationPolicy_(A.NSApplicationActivationPolicyAccessory)
    delegate = MacLinkDelegate.alloc().init()
    app.setDelegate_(delegate)
    app.run()
    return 0


def main():
    parser = argparse.ArgumentParser(description='MacLink menu bar connector')
    parser.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--config', type=Path, default=CONFIG_PATH)
    parser.add_argument('--self-test', action='store_true', help='Check packaged dependencies without starting a connector.')
    parser.add_argument('--show-panel', action='store_true', help='Show the menu bar dashboard on launch.')
    parser.add_argument('--preview-ui', action='store_true', help='Preview the native dashboard without reading keys or starting a connector.')
    args = parser.parse_args()
    if sys.platform != 'darwin':
        parser.error('MacLink requires macOS.')
    if args.worker and (args.preview_ui or args.show_panel):
        parser.error('Worker mode cannot display the native dashboard.')
    if args.self_test:
        self_test()
        return 0
    if args.worker:
        return run_worker(args.config)
    return run_app(show_panel=args.show_panel, preview_ui=args.preview_ui)


if __name__ == '__main__':
    raise SystemExit(main())
