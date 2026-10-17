import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseInviteCode,inviteError} from '../lib/invite-code.ts';
const code='a1'.repeat(12)+'.'+'b2'.repeat(32);
const url='https://maclink.example/#join='+code;
test('complete invitation URL and raw code prefill identically on opening or reloading',()=>{
 for(const text of [url,code,url.replace('#','?'),code.toUpperCase(),'join='+code])assert.equal(parseInviteCode(text),code);
 assert.equal(parseInviteCode(new URL(url).href),code);
});
test('messenger wrapping, invisible characters, line breaks and encoded URLs preserve complete codes',()=>{
 for(const text of ['[초대]('+url+')','접속 링크: '+url+'\n',encodeURIComponent(url),encodeURIComponent(encodeURIComponent(url)),code.slice(0,44)+'\n\u200B'+code.slice(44),'〈'+url+'〉'])assert.equal(parseInviteCode(text),code);
});
test('missing, truncated, overlong and ambiguous codes are never guessed',()=>{
 const other='c3'.repeat(12)+'.'+'d4'.repeat(32);
 for(const text of ['https://maclink.example/',url.slice(0,-1),code+'c','c'+code,url+';'+other,code.slice(0,24),null,'x'.repeat(8200)])assert.equal(parseInviteCode(text),null);
 assert.match(inviteError('https://maclink.example/'),/기본 주소/);
});
test('only one unambiguous capability survives copied message text',()=>{
 assert.equal(parseInviteCode(url+';접속 코드:'+code),code);
 assert.equal(parseInviteCode('비밀번호 또는 일반 사이트 주소'),null);
});
