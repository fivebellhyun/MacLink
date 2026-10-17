"""Native UI translations and an explicit, app-only language preference.

Reading the language never writes preferences. Device names, URLs and unknown
messages pass through unchanged; the remote desktop protocol is independent.
"""
LANGUAGE_KEY = 'MacLinkUILanguage'
LANGUAGES = ('ko', 'en')

ENGLISH = {
    '홈': 'Home', '설정': 'Settings', '후원': 'Support',
    '표시 언어': 'Display language', '언어 설정': 'Language settings',
    '버전 확인': 'Version check', '최신 버전 확인': 'Check for updates',
    '현재 버전: {version}': 'Current version: {version}',
    '버튼을 눌러 최신 버전을 확인하세요.': 'Press the button to check for updates.',
    '최신 버전 확인 중…': 'Checking for updates…',
    '최신 버전입니다.': 'You are up to date.',
    '새 버전 v{version}이 있습니다.': 'New version available: v{version}.',
    '공개된 릴리스를 찾을 수 없습니다.': 'No public release was found.',
    '버전 확인에 실패했습니다. 다시 시도해 주세요.': 'Could not check for updates. Try again.',
    '한국어': '한국어', '선택됨': 'Selected',
    '함께 만드는 MacLink': 'Build MacLink together',
    '코드, 디자인, 번역으로 MacLink를 함께 만들어 주세요.\n여러분의 아이디어와 재능을 GitHub 오픈소스에 보태 주세요.':
        'Help build MacLink with code, design, or translation.\nShare your ideas and talents through GitHub open source.',
    'MacLink 메뉴 막대 앱': 'MacLink menu bar app', 'MacLink 아이콘': 'MacLink icon',
    'MacLink 화면 선택': 'MacLink view', 'MacLink 웹사이트 열기': 'Open MacLink website',
    'MacLink GitHub 저장소 열기': 'Open MacLink GitHub repository',
    'GitHub 저장소 열기': 'Open GitHub repository',
    'MacLink 종료': 'Quit MacLink', 'MacLink에 힘을 보태 주세요': 'Support MacLink',
    'PayPal 후원 · 준비 중\n지금은 마음만 감사히 받고 있어요.':
        'PayPal support · Coming soon\nFor now, your encouragement is enough.',
    'UI 미리보기입니다.\n기기 키와 실제 권한 상태는 읽지 않습니다.':
        'UI preview.\nDevice keys and actual permissions are not read.',
    'macOS 권한 설정': 'macOS permissions',
    '권한 설정이 필요합니다.\n설정에서 화면 기록과 기기 제어를 허용해 주세요.':
        'Permissions are required.\nAllow Screen Recording and device control in Settings.',
    '권한 설정': 'Permission settings', '권한 필요': 'Permission required',
    '기기 제어': 'Device control', '기기 키 가져오기': 'Import connection key',
    '기기 키 가져오기…': 'Import connection key…',
    '기기 키를 가져와 연결하세요': 'Import a connection key to connect',
    '기기 키와 권한은 설정에서 관리할 수 있습니다.': 'Manage your connection key and permissions in Settings.',
    '기기 키와 서버 연결 상태를 확인해 주세요.\n연결 설정과 로그는 설정 탭에서 볼 수 있습니다.':
        'Check your connection key and server status.\nConnection settings and logs are in Settings.',
    '다시 시작': 'Restart', '다시 연결': 'Reconnect', '로그 열기': 'Open log',
    '로그인할 때 MacLink 시작': 'Start MacLink at login', '로그인 시 실행': 'Start at login',
    '미리보기': 'Preview', '서버 연결': 'Server connection',
    '서버에 연결되어 있습니다.\n웹에서 이 Mac을 선택해 연결을 요청하세요.':
        'Connected to the server.\nSelect this Mac on the website to connect.',
    '세션: ': 'Session: ', '세션: 없음': 'Session: None',
    '시스템 설정에서 이 MacLink 앱을 허용해 주세요.': 'Allow this MacLink app in System Settings.',
    '시스템 설정에서 화면 기록 권한 열기': 'Open Screen Recording permissions in System Settings',
    '시스템 설정의 손쉬운 사용에서 기기 제어 권한 열기': 'Open device control permissions under Accessibility in System Settings',
    '시작': 'Start', '중지': 'Stop', '연결 중지': 'Stop connection',
    '웹에서 받은 기기 키로 연결을 설정하세요.': 'Set up the connection with the key from your website.',
    '응원의 마음 전하기': 'Send your encouragement', '이 Mac 연결하기': 'Connect this Mac',
    '작은 응원이 다음 연결을 만드는 힘이 됩니다.': 'Your encouragement helps keep MacLink going.',
    '접근 권한': 'Permissions', '커넥터': 'Connector', '커넥터 시작': 'Start connector',
    '허용됨': 'Allowed', '화면 기록': 'Screen Recording', '확인 안 함': 'Not checked',
    '확인 중': 'Checking', 'MacLink UI 미리보기': 'MacLink UI preview',
    '연결: 설정 필요': 'Connection: Setup required', '화면 기록: 확인 중': 'Screen Recording: Checking',
    '기기 제어: 확인 중': 'Device control: Checking', '화면 기록: 확인 안 함': 'Screen Recording: Not checked',
    '기기 제어: 확인 안 함': 'Device control: Not checked',
    '연결: ': 'Connection: ', '화면 기록: ': 'Screen Recording: ', '기기 제어: ': 'Device control: ',
    '설정 필요': 'Setup required', '중지됨': 'Stopped', '기존 커넥터 실행 중': 'Another connector is running',
    '시작 중': 'Starting', '연결 중': 'Connecting', '서버 연결됨': 'Connected to server',
    '재연결 중': 'Reconnecting', '중지 중': 'Stopping', '오류': 'Error',
    '기기 키 취소됨 — 새 키 가져오기': 'Connection key revoked — import a new key',
    '오류 — 로그 확인': 'Error — check the log', '시작 실패 — 로그 확인': 'Could not start — check the log',
    '없음': 'None', '승인 대기': 'Awaiting approval', '준비 중': 'Preparing',
    '접속 중': 'Connected', '일시 중지': 'Paused', '화면 보기': 'View only', '원격 제어': 'Remote control',
    '화면 기록 설정…': 'Screen Recording settings…', '기기 제어 설정…': 'Accessibility settings…',
    '확인': 'OK', '가져오기': 'Import', '취소': 'Cancel',
    '마음만 감사히 받겠습니다': 'Thank you for your support',
    '아직 후원 기능은 지원하지 않습니다. 마음만 감사히 받겠습니다.':
        'Support payments are not available yet. Your encouragement is sincerely appreciated.',
    '껌 던져주기': 'Send some gum', '따뜻한 커피 한 잔 후원하기': 'Buy a warm cup of coffee',
    '한 끼 대접하기': 'Buy a meal',
    '커넥터를 시작하지 못했습니다. 로그를 확인해 주세요.': 'Could not start the connector. Check the log.',
    '커넥터를 시작할 수 없습니다': 'Could not start the connector',
    '기기 키를 가져올 수 없습니다': 'Could not import the connection key',
    '읽을 수 있는 MacLink JSON 파일을 선택하세요.': 'Select a readable MacLink JSON file.',
    '웹사이트에서 다운로드한 maclink-config.json을 선택하세요.': 'Select maclink-config.json downloaded from your website.',
    '이 기기 키를 사용하시겠습니까?': 'Use this connection key?',
    '웹사이트: {site}\n기기: {name}\n\n이 웹사이트에 등록한 본인의 기기인지 확인하세요. 기존 키가 있으면 교체되며 현재 원격 세션은 종료됩니다. 일회용 초대는 Mac에서 연결 승인을 요청합니다.':
        'Website: {site}\nDevice: {name}\n\nConfirm this is your device registered on this website. Any existing key will be replaced and the current remote session will end. One-time invitations request approval on the Mac.',
    '연결 로그를 확인해 주세요.': 'Check the connection log.',
    '로그인 실행 설정 실패': 'Could not change login startup',
    '로그인 항목을 변경하지 못했습니다. 시스템 설정 → 일반 → 로그인 항목을 확인하세요.':
        'Could not change login items. Check System Settings → General → Login Items.',
    '언어를 변경할 수 없습니다': 'Could not change the language',
    '표시 언어 설정을 저장하지 못했습니다.': 'Could not save the display language preference.',
    'MacLink 데이터 폴더는 현재 사용자 소유여야 합니다.': 'MacLink data folder must be owned by the current user.',
    '선택한 파일은 유효한 MacLink JSON 파일이 아닙니다.': 'The selected file is not a valid MacLink JSON file.',
    '선택한 파일이 너무 큽니다.': 'The selected file is too large.',
    '기기 키 파일에는 JSON 객체가 있어야 합니다.': 'The device key file must contain a JSON object.',
    '기기 키 파일에 웹사이트, 기기 또는 키가 없습니다.': 'The device key file is missing a website, device, or key.',
    '웹사이트 주소는 인증 정보가 없는 기본 HTTPS 주소여야 합니다.': 'The website must be a base HTTPS address without credentials.',
    '기기 키가 유효하지 않습니다. 웹사이트에서 새 키를 다운로드하세요.': 'The device key is invalid. Download a new key from your website.',
    '기기 이름이 유효하지 않습니다.': 'The device name is invalid.',
    '무인 연결 설정은 true 또는 false여야 합니다.': 'The unattended setting must be true or false.',
    '다른 MacLink 커넥터가 실행 중입니다. 기존 Terminal 또는 로그인 커넥터를 먼저 중지하세요.':
        'Another MacLink connector is running. Stop the old Terminal or login connector first.',
}

# Only these exact, known local validation errors are translated from runtime
# English. Unknown exception text and all user-provided content remain intact.
_RUNTIME_KEYS = {ENGLISH[key]: key for key in (
    'MacLink 데이터 폴더는 현재 사용자 소유여야 합니다.',
    '선택한 파일은 유효한 MacLink JSON 파일이 아닙니다.', '선택한 파일이 너무 큽니다.',
    '기기 키 파일에는 JSON 객체가 있어야 합니다.', '기기 키 파일에 웹사이트, 기기 또는 키가 없습니다.',
    '웹사이트 주소는 인증 정보가 없는 기본 HTTPS 주소여야 합니다.',
    '기기 키가 유효하지 않습니다. 웹사이트에서 새 키를 다운로드하세요.', '기기 이름이 유효하지 않습니다.',
    '무인 연결 설정은 true 또는 false여야 합니다.',
    '다른 MacLink 커넥터가 실행 중입니다. 기존 Terminal 또는 로그인 커넥터를 먼저 중지하세요.',
)}


def _defaults():
    from Foundation import NSUserDefaults
    return NSUserDefaults.standardUserDefaults()


def current_language() -> str:
    try:
        defaults = _defaults()
        choice = defaults.stringForKey_(LANGUAGE_KEY)
        if choice in LANGUAGES:
            return choice
        languages = defaults.arrayForKey_('AppleLanguages') or []
        first = str(languages[0]).lower().replace('_', '-') if languages else ''
        return 'ko' if first.split('-')[0] == 'ko' else 'en'
    except Exception:
        return 'en'


def set_language(language: str) -> None:
    if language not in LANGUAGES:
        raise ValueError('Unsupported interface language.')
    _defaults().setObject_forKey_(language, LANGUAGE_KEY)


def tr(text: str, language=None) -> str:
    key = _RUNTIME_KEYS.get(text, text)
    selected = current_language() if language is None else language
    return key if selected == 'ko' else ENGLISH.get(key, text)
