import {test} from 'node:test';
import assert from 'node:assert/strict';
import {QUALITY_PROFILES,isVideoQuality,qualityProfileLabel,qualityProfileDescription} from '../lib/quality.ts';
import {translateMessage} from '../lib/i18n.ts';

test('the four stable quality IDs expose the requested resolution and frame-rate targets',()=>{
 assert.deepEqual(QUALITY_PROFILES.map(({id,width,height,fps})=>({id,width,height,fps})),[
  {id:'low',width:1600,height:null,fps:15},
  {id:'balanced',width:1600,height:null,fps:24},
  {id:'high',width:2560,height:null,fps:30},
  {id:'ultra',width:2560,height:null,fps:60},
 ]);
 for(const profile of QUALITY_PROFILES)assert.equal(isVideoQuality(profile.id),true);
 for(const value of ['native','4k','__proto__',null,{},24])assert.equal(isVideoQuality(value),false);
});

test('quality labels translate every preset with its resolution and frame-rate target',()=>{
 const labels=locale=>QUALITY_PROFILES.map(profile=>qualityProfileLabel(profile,message=>translateMessage(message,locale)));
 assert.deepEqual(labels('ko'),['빠르게 · 1600px / 15fps','중간 · 1600px / 24fps','선명하게 · 2560px / 30fps','최고 · 2560px / 60fps']);
 assert.deepEqual(labels('en'),['Fast · 1600px / 15fps','Medium · 1600px / 24fps','Sharp · 2560px / 30fps','Ultra · 2560px / 60fps']);
});

test('bitrate descriptions identify settings rather than measurements and explain high-frame-rate bandwidth',()=>{
 assert.deepEqual(QUALITY_PROFILES.map(profile=>[profile.targetMbps,profile.maxMbps]),[[2,4],[4,8],[8,16],[16,40]]);
 for(const locale of ['ko','en'])for(const profile of QUALITY_PROFILES){
  const description=qualityProfileDescription(profile,(message,params)=>translateMessage(message,locale,params));
  assert.ok(description.includes(profile.targetMbps+' Mbps'));
  assert.ok(description.includes(profile.maxMbps+' Mbps'));
  assert.ok(description.includes(locale==='ko'?'실측값이 아니며':'not measurements'));
  assert.equal(description.includes(locale==='ko'?'빠르고 안정적인':'fast, stable'),profile.id==='ultra');
  assert.equal(description.includes('2560px / 60fps'),profile.id==='ultra');
  if(profile.id==='ultra')assert.ok(description.includes(locale==='ko'?'실제 프레임 수는 Mac 성능과 연결 상태에 따라':'Actual frame rate depends on Mac performance and the connection'));
  if(locale==='en')assert.equal(/[가-힣]/u.test(description),false);
 }
});
