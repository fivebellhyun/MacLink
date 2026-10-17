import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { messages, normalizeLocale, preferredLocale, translateMessage } from '../lib/i18n.ts';

test('a saved supported locale wins over browser languages', () => {
  assert.equal(preferredLocale('ko', ['en-US', 'en']), 'ko');
  assert.equal(preferredLocale('en', ['ko-KR', 'ko']), 'en');
  assert.equal(preferredLocale('EN_us', ['ko']), 'en');
  assert.equal(preferredLocale('ko-KR', []), 'ko');
});

test('browser detection uses supported languages in order and falls back to English', () => {
  assert.equal(preferredLocale(null, ['fr-FR', 'ko-KR', 'en-US']), 'ko');
  assert.equal(preferredLocale('unsupported', ['ja', 'en-GB', 'ko']), 'en');
  assert.equal(preferredLocale(undefined, []), 'en');
  assert.equal(preferredLocale('', ['de-DE', 'ja']), 'en');
  assert.equal(normalizeLocale('KO_kr'), 'ko');
  for (const value of [null, undefined, 0, {}, '', 'fr', 'korean', 'english']) {
    assert.equal(normalizeLocale(value), null);
  }
});

test('English covers home, connection settings, remote display, quality and keyboard mapping', () => {
  const examples = {
    '내 기기': 'My devices',
    'Google로 로그인': 'Sign in with Google',
    'Google 계정으로 로그인됨': 'Signed in with Google',
    '로그아웃': 'Sign out',
    '호스트의 Google 로그인 이메일': "Host's Google sign-in email",
    '맥 소유자가 Google로 로그인할 때 사용하는 이메일을 입력하세요.': 'Enter the email the Mac owner uses to sign in with Google.',
    '기존 연결 키로 기기 가져오기': 'Import device with an existing key',
    '가져올 MacLink 연결 키 파일': 'MacLink connection key file to import',
    '연결 키 파일은 16 KB 이하여야 합니다.': 'The connection key file must be 16 KB or smaller.',
    '유효한 MacLink 연결 키 파일을 선택해 주세요.': 'Choose a valid MacLink connection key file.',
    '이 연결 키의 기기를 현재 Google 계정으로 가져올까요? 기존 초대 링크와 접속 세션은 종료됩니다.': 'Import the device for this connection key into the current Google account? Existing invitation links and sessions will end.',
    '기기를 가져왔습니다. 새 초대 링크를 만들어 주세요.': 'Your device was imported. Create a new invitation link.',
    '맥북을 등록한 Google 계정으로 로그인해 TURN을 설정하세요. 초대받은 사람은 로그인 없이 접속할 수 있습니다.': 'Sign in with the Google account that registered your MacBook to configure TURN. Invited guests can connect without signing in.',
    '맥북을 등록하려면 Google로 로그인해 주세요.': 'Sign in with Google to register your MacBook.',
    '원격 접속': 'Remote access',
    'TURN 설정됨': 'TURN configured',
    '키 확인 후 저장': 'Verify and save key',
    '연결됨 · 시간 제한 없음': 'Connected · No time limit',
    '원격 화면 화질': 'Remote screen quality',
    '빠르게': 'Fast',
    '균형': 'Balanced',
    '중간': 'Medium',
    '선명하게': 'Sharp',
    '최고': 'Ultra',
    '최고 화질은 2560px / 60fps를 목표로 하며 빠르고 안정적인 네트워크가 필요합니다. 실제 프레임 수는 Mac 성능과 연결 상태에 따라 달라집니다.': 'Ultra targets 2560px / 60fps and requires a fast, stable network. Actual frame rate depends on Mac performance and the connection.',
    '키보드 매핑': 'Keyboard mapping',
    'Ctrl ↔ Command 교환 · Windows 추천': 'Swap Ctrl ↔ Command · Recommended for Windows',
    '기기 접속 권한이 해제되었습니다.': 'Access to this device has been revoked.',
  };
  for (const [korean, english] of Object.entries(examples)) {
    assert.equal(translateMessage(korean, 'en'), english);
    assert.equal(translateMessage(korean, 'ko'), korean);
  }
});

test('English API and native permission reasons translate back for Korean viewers', () => {
  const examples = {
    'Device not found.': '기기를 찾을 수 없습니다.',
    'Screen Recording permission is not enabled on the MacBook.': '맥북에 화면 기록 권한이 없습니다.',
    'Accessibility permission is not enabled on the MacBook. Connect with a view-only invitation or grant permission.': '맥북에 손쉬운 사용 권한이 없습니다. 보기 전용 초대로 연결하거나 권한을 허용하세요.',
    'Screen Recording or Accessibility permission was revoked on the MacBook.': '맥북에서 화면 또는 입력 권한이 해제되었습니다.',
  };
  for (const [english, korean] of Object.entries(examples)) {
    assert.equal(translateMessage(english, 'ko'), korean);
    assert.equal(translateMessage(english, 'en'), english);
  }
});

test('named placeholders preserve Unicode and literal replacement syntax in user names', () => {
  const template = '{name}의 연결 키를 다운로드했습니다. MacLink 앱을 열고 메뉴바의 Import connection key…(연결 키 가져오기)에서 maclink-config.json을 선택하세요.';
  const name = '행복한 가족 $& $1 {code} 💻';
  const params = { name, code: 701 };
  const original = { ...params };
  const english = translateMessage(template, 'en', params);
  const korean = translateMessage(template, 'ko', params);
  assert.ok(english.includes(name));
  assert.equal(/[가-힣]/u.test(english.replace(name, '')), false);
  assert.equal(korean, name + '의 연결 키를 다운로드했습니다. MacLink 앱을 열고 메뉴바의 Import connection key…(연결 키 가져오기)에서 maclink-config.json을 선택하세요.');
  assert.deepEqual(params, original);
  assert.equal(translateMessage('키 확인·저장: {date}', 'en', { date: 0 }), 'Key verified and saved: 0');
  assert.ok(translateMessage(template, 'en').includes('{name}'));
});

test('numeric TURN diagnostic codes translate in both directions without swallowing unknown errors', () => {
  const korean = 'TURN/TLS 443 후보 수집 오류 701. 네트워크 정책 또는 TURN 키 상태를 확인하세요.';
  const english = 'TURN/TLS 443 candidate collection error 701. Check the network policy or TURN key status.';
  assert.equal(translateMessage(korean, 'en'), english);
  assert.equal(translateMessage(english, 'ko'), korean);
  const template = 'TURN/TLS 443 후보 수집 오류 {code}. 네트워크 정책 또는 TURN 키 상태를 확인하세요.';
  assert.equal(translateMessage(template, 'en', { code: 701 }), english);
  const custom = 'TURN/TLS 443 후보 수집 오류 CUSTOM. 네트워크 정책 또는 TURN 키 상태를 확인하세요.';
  assert.equal(translateMessage(custom, 'en'), custom);
});

test('unrecognized user data and protocol values stay unchanged in either locale', () => {
  const values = [
    '우리 가족 MacBook Pro 💻',
    'https://example.org/#join=abcd.1234',
    'turns:turn.cloudflare.com:443?transport=tcp',
    'v=0\r\na=mid:video\r\n',
    'Custom dependency failure: 123',
    '__proto__',
    'constructor',
    'toString',
    '{unknown}',
    '',
  ];
  for (const value of values) for (const locale of ['ko', 'en']) {
    assert.equal(translateMessage(value, locale), value);
  }
});

test('all catalog translations are English and retain the same named placeholders', () => {
  const placeholders = value => [...value.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(match => match[1]).sort();
  assert.ok(Object.keys(messages).length > 100);
  for (const [korean, english] of Object.entries(messages)) {
    assert.ok(english.trim(), korean);
    assert.equal(/[가-힣]/u.test(english), false, korean);
    assert.deepEqual(placeholders(english), placeholders(korean), korean);
    assert.equal(translateMessage(korean, 'en'), english, korean);
    const canonical = translateMessage(english, 'ko');
    assert.equal(messages[canonical], english, english);
  }
});

test('visible Korean JSX and UI message literals are covered by the translation catalog', () => {
  const files = [
    'app/page.tsx',
    'components/network-settings.tsx',
    'components/remote-viewer.tsx',
    'components/remote-settings.tsx',
    'lib/quality.ts',
  ];
  const failures = [];
  for (const file of files) {
    const source = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    const root = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    function visit(node) {
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && /[가-힣]/u.test(node.text)) {
        if (!Object.hasOwn(messages, node.text)) failures.push(file + ': Missing message ' + JSON.stringify(node.text));
        if (ts.isJsxAttribute(node.parent)) failures.push(file + ': Untranslated JSX attribute ' + node.text);
      }
      if (ts.isJsxText(node) && /[가-힣]/u.test(node.text)) failures.push(file + ': Untranslated JSX text ' + node.text.trim());
      ts.forEachChild(node, visit);
    }
    visit(root);
  }
  assert.deepEqual(failures, []);
});

function uiSource(file) {
  const source = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function findNodes(root, predicate) {
  const matches = [];
  function visit(node) {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(root);
  return matches;
}

function jsxAttribute(node, name) {
  return node.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText() === name)?.initializer;
}

test('owner login links use Google and sign-out is a same-origin POST form', () => {
  for (const file of ['app/page.tsx', 'components/network-settings.tsx']) {
    const source = uiSource(file);
    const loginLinks = findNodes(source, node => ts.isJsxOpeningElement(node) && node.tagName.getText() === 'a')
      .filter(node => jsxAttribute(node, 'href')?.text?.startsWith('/auth/'));
    assert.ok(loginLinks.length > 0, file);
    for (const link of loginLinks) {
      assert.equal(jsxAttribute(link, 'href').text, '/auth/google?return_to=%2F');
      assert.equal(jsxAttribute(link, 'target').text, '_top');
    }
    assert.doesNotMatch(source.text, /ChatGPT|signin-with-chatgpt/);
  }
  const forms = findNodes(uiSource('app/page.tsx'), node => ts.isJsxOpeningElement(node) && node.tagName.getText() === 'form');
  const signout = forms.find(node => jsxAttribute(node, 'action')?.text === '/auth/signout');
  assert.ok(signout);
  assert.equal(jsxAttribute(signout, 'method').text, 'post');
});

function claimHarness(confirmed = true) {
  const source = uiSource('app/page.tsx');
  const claim = findNodes(source, node => ts.isFunctionDeclaration(node) && node.name?.text === 'claimDevice')[0];
  assert.ok(claim);
  const compiled = ts.transpileModule(claim.getText(), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const calls = [];
  const invoke = new Function('work', 'confirm', 't', 'api', 'refresh', 'notify', compiled + '; return claimDevice;')(
    action => action(),
    text => { calls.push(['confirm', text]); return confirmed; },
    text => text,
    async (...args) => { calls.push(['api', ...args]); },
    async () => { calls.push(['refresh']); },
    text => { calls.push(['notify', text]); },
  );
  return { invoke, calls };
}

const connectionKey = { device: 'a'.repeat(24), token: 'b'.repeat(64) };
const keyFile = value => ({ size: 1024, text: async () => JSON.stringify(value) });

test('device import sends only the validated key to the same-origin API after confirmation', async () => {
  const { invoke, calls } = claimHarness();
  await invoke(keyFile({ ...connectionKey, site: 'https://untrusted.invalid', owner: 'ignored' }));
  assert.deepEqual(calls, [
    ['confirm', '이 연결 키의 기기를 현재 Google 계정으로 가져올까요? 기존 초대 링크와 접속 세션은 종료됩니다.'],
    ['api', 'devices/claim', 'POST', { ...connectionKey, confirm: true }],
    ['refresh'],
    ['notify', '기기를 가져왔습니다. 새 초대 링크를 만들어 주세요.'],
  ]);
});

test('device import rejects oversized or invalid files without revealing file contents or sending requests', async () => {
  const { invoke, calls } = claimHarness();
  let read = false;
  await assert.rejects(invoke({ size: 16 * 1024 + 1, text: async () => { read = true; return ''; } }), { message: '연결 키 파일은 16 KB 이하여야 합니다.' });
  assert.equal(read, false);
  const invalid = [null, [], {}, { ...connectionKey, device: 'x'.repeat(24) }, { ...connectionKey, token: 'b'.repeat(63) }];
  for (const value of invalid) {
    await assert.rejects(invoke(keyFile(value)), { message: '유효한 MacLink 연결 키 파일을 선택해 주세요.' });
  }
  await assert.rejects(invoke({ size: 20, text: async () => 'private invalid input' }), { message: '유효한 MacLink 연결 키 파일을 선택해 주세요.' });
  await assert.rejects(invoke({ size: 20, text: async () => { throw new Error('private file path'); } }), { message: '유효한 MacLink 연결 키 파일을 선택해 주세요.' });
  assert.deepEqual(calls, []);
});

test('device import cancellation makes no request and file input is reset before validation', async () => {
  const { invoke, calls } = claimHarness(false);
  await invoke(keyFile(connectionKey));
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'confirm');

  const input = findNodes(uiSource('app/page.tsx'), node => ts.isJsxSelfClosingElement(node) && jsxAttribute(node, 'ref')?.expression?.getText() === 'claimInput')[0];
  assert.ok(input);
  assert.equal(jsxAttribute(input, 'accept').text, '.json');
  const change = jsxAttribute(input, 'onChange').expression;
  const compiled = ts.transpileModule('const changed = ' + change.getText(), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const target = { files: [keyFile(connectionKey)], value: 'selected-key.json' };
  let received;
  new Function('claimDevice', compiled + '; return changed;')(file => {
    assert.equal(target.value, '');
    received = file;
  })({ currentTarget: target });
  assert.equal(received, target.files[0]);
});
