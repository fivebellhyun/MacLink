import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readTouchInputMode,writeTouchInputMode,DEFAULT_TOUCH_INPUT_MODE,TOUCH_INPUT_MODE_STORAGE} from '../lib/touch-input-mode.ts';

function memory(initial={}){const data={...initial};return {data,getItem:key=>key in data?data[key]:null,setItem:(key,value)=>{data[key]=String(value);}};}

test('the chosen touch input mode is remembered in this browser',()=>{
 const storage=memory();
 assert.equal(readTouchInputMode(storage),DEFAULT_TOUCH_INPUT_MODE);
 assert.equal(writeTouchInputMode(storage,'touch'),true);
 assert.equal(storage.data[TOUCH_INPUT_MODE_STORAGE],'touch');
 assert.equal(readTouchInputMode(storage),'touch');
 writeTouchInputMode(storage,'joystick');
 assert.equal(readTouchInputMode(storage),'joystick');
});

test('unknown, tampered or unavailable storage falls back to the default mode',()=>{
 for(const value of ['','Touch','mouse','{"mode":"touch"}','__proto__'])assert.equal(readTouchInputMode(memory({[TOUCH_INPUT_MODE_STORAGE]:value})),DEFAULT_TOUCH_INPUT_MODE);
 const blocked={getItem(){throw new Error('SecurityError');},setItem(){throw new Error('QuotaExceededError');}};
 assert.equal(readTouchInputMode(blocked),DEFAULT_TOUCH_INPUT_MODE);
 assert.equal(writeTouchInputMode(blocked,'touch'),false);
});
