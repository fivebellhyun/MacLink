import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { apiMessages } from '../lib/locales/api.ts';
import { localizeApiPayload, negotiateLocale } from '../lib/i18n-api.ts';
import { handleApi } from '../lib/server.ts';

test('API language negotiation honors supported language priorities and defaults to Korean', () => {
  for (const header of [null, undefined, '', 'fr-FR,ja;q=0.9']) assert.equal(negotiateLocale(header), 'ko');
  assert.equal(negotiateLocale('en-US,en;q=0.9,ko;q=0.8'), 'en');
  assert.equal(negotiateLocale('en;q=0.5, ko-KR;q=0.9'), 'ko');
  assert.equal(negotiateLocale('ja;q=1, en-GB;q=0.8,ko;q=0.2'), 'en');
  assert.equal(negotiateLocale('en;q=0,ko;q=0.4'), 'ko');
  assert.equal(negotiateLocale('en;q=invalid,ko'), 'ko');
  assert.equal(negotiateLocale('EN-us; q=1'), 'en');
});

test('only exact known message fields are translated, including nested array entries', () => {
  const message = '기기 접속 권한이 해제되었습니다.';
  const input = {
    error: message, reason: null,
    devices: [{ name: message, sessions: [{ reason: message, guest_name: message }] }],
    errors: [{ warning: message, error: 'A custom dependency error.' }],
    text: message, payload: JSON.stringify({ type: 'text', text: message }),
    token: message, username: message, credential: message,
    urls: ['turns:turn.cloudflare.com:443?transport=tcp', message],
    offer: 'v=0\r\n' + message, answer: message,
    sql: "SELECT '" + message + "'", arbitrary: [message],
  };
  const original = structuredClone(input);
  const english = localizeApiPayload(input, 'en');
  assert.equal(english.error, 'Access to this device has been revoked.');
  assert.equal(english.devices[0].sessions[0].reason, english.error);
  assert.equal(english.errors[0].warning, english.error);
  assert.equal(english.errors[0].error, 'A custom dependency error.');
  for (const key of ['text', 'payload', 'token', 'username', 'credential', 'urls', 'offer', 'answer', 'sql', 'arbitrary']) assert.deepEqual(english[key], input[key]);
  assert.equal(english.devices[0].name, message);
  assert.equal(english.devices[0].sessions[0].guest_name, message);
  assert.deepEqual(input, original);
  assert.deepEqual(localizeApiPayload(english, 'ko'), original);
});

test('current connector permission errors translate without the removed invitation flow', () => {
  for (const [english, korean] of [
    ['Accessibility permission is not enabled on the MacBook.', '맥북에 기기 제어 권한이 없습니다.'],
    ['Screen Recording or Accessibility permission is not enabled on the MacBook.', '맥북에 화면 기록 또는 기기 제어 권한이 없습니다.'],
  ]) {
    assert.equal(localizeApiPayload({ reason: english }, 'ko').reason, korean);
    assert.equal(localizeApiPayload({ reason: english }, 'en').reason, english);
  }
});

test('HTTP errors keep the legacy Korean default and advertise English when requested', async () => {
  const ko = await handleApi(new Request('https://maclink.example/api/devices'), {});
  assert.equal(ko.status, 503);
  assert.equal(ko.headers.get('Content-Language'), 'ko');
  assert.equal((await ko.json()).error, '저장소가 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.');
  const en = await handleApi(new Request('https://maclink.example/api/devices', { headers: { 'Accept-Language': 'en-US,en;q=0.9' } }), {});
  assert.equal(en.status, 503);
  assert.equal(en.headers.get('Content-Language'), 'en');
  assert.equal(en.headers.get('Vary'), 'Accept-Language');
  assert.equal((await en.json()).error, 'Storage is not ready. Please try again shortly.');
  for (const locale of [undefined, 'en']) {
    const headers = { Origin: 'https://another.example', ...(locale ? { 'Accept-Language': locale } : {}) };
    const blocked = await handleApi(new Request('https://maclink.example/api/devices', { method: 'POST', headers }), {});
    assert.equal(blocked.status, 403);
    assert.equal((await blocked.json()).error, locale === 'en' ? 'Requests from other websites are not allowed.' : '다른 사이트의 요청은 허용하지 않습니다.');
  }
});

test('TURN warnings and native persisted reasons follow request language without changing protocol fields', async () => {
  const session = { id: 'session', status: 'ended', mode: 'control', answer: 'v=0\r\n기기를 찾을 수 없습니다.', reason: 'Screen Recording permission is not enabled on the MacBook.', generation: 0, transport: 'webrtc' };
  const env = { AUTH_BASE_URL:'https://maclink.example', DB: { prepare(sql) { return { bind() { return this; }, async first() { return sql.includes('FROM auth_sessions') ? {id:'google:owner',email:'owner@example.com',name:null} : sql.includes('FROM sessions') ? session : null; } }; } }, BUCKET: {} };
  const warning = await handleApi(new Request('https://maclink.example/api/network/ice', { headers: { Cookie: '__Host-maclink_session='+'a'.repeat(43), 'Accept-Language': 'en' } }), env);
  assert.equal(warning.status, 200);
  const ice = await warning.json();
  assert.equal(ice.warning, 'The Mac owner can configure TURN to enable TLS 443 relay connections on restricted networks.');
  assert.deepEqual(ice.iceServers, [{ urls: ['stun:stun.cloudflare.com:3478'] }]);
  const response = await handleApi(new Request('https://maclink.example/api/sessions/session', { headers: { Authorization: 'Bearer ' + 'a'.repeat(64), Cookie: '__Host-maclink_session='+'a'.repeat(43), 'Accept-Language': 'ko' } }), env);
  const body = await response.json();
  assert.equal(body.reason, '맥북에 화면 기록 권한이 없습니다.');
  assert.equal(body.answer, session.answer);
  assert.equal(body.mode, session.mode);
  assert.equal(body.status, session.status);
});

test('the catalog covers every static visible Korean helper and API message', () => {
  const files = ['lib/enrollment.ts', 'lib/server.ts', 'lib/turn.ts', 'lib/remote-client.ts'];
  for (const file of files) {
    const source = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    for (const [, , text] of source.matchAll(/(['"])(.*?)\1/g)) {
      if (!/[가-힣]/u.test(text)) continue;
      // The SQL statement contains a reason literal; it must never itself be translated.
      if (text.startsWith('UPDATE sessions SET ')) {
        assert.ok(Object.hasOwn(apiMessages, text.match(/reason='([^']+)'/)[1]), file);
        continue;
      }
      // This one error is assembled from a browser-generated numeric ICE code.
      if (text === 'TURN/TLS 443 후보 수집 오류 ' || text === '. 네트워크 정책 또는 TURN 키 상태를 확인하세요.') {
        assert.ok(Object.hasOwn(apiMessages, 'TURN/TLS 443 후보 수집 오류 {code}. 네트워크 정책 또는 TURN 키 상태를 확인하세요.'));
        continue;
      }
      assert.ok(Object.hasOwn(apiMessages, text), file + ': ' + text);
      assert.ok(apiMessages[text].length > 0);
      assert.equal(/[가-힣]/u.test(apiMessages[text]), false, file + ': ' + text);
    }
  }
});
