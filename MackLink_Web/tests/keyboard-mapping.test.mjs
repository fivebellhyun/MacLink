import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 DEFAULT_KEYBOARD_MAPPING as native,
 WINDOWS_KEYBOARD_MAPPING as windows,
 KEYBOARD_MAPPING_STORAGE,
 KeyboardMapper,
 mappingPreset,
 readKeyboardMapping,
 validKeyboardMapping,
 writeKeyboardMapping,
} from '../lib/keyboard-mapping.ts';

const key=(code,down)=>({type:'key',code,down});
const flags=(value={})=>({ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,...value});

test('native mapping preserves modifier sides and ordinary keys',()=>{
 const mapper=new KeyboardMapper();
 for(const source of ['Control','Meta','Alt','Shift'])for(const side of ['Left','Right']){
  const code=source+side;
  assert.deepEqual(mapper.key(code,true,native),[key(code,true)]);
  assert.deepEqual(mapper.key(code,false,native),[key(code,false)]);
 }
 assert.deepEqual(mapper.key('KeyC',true,native),[key('KeyC',true)]);
 assert.deepEqual(mapper.key('KeyC',false,native),[key('KeyC',false)]);
});

test('Windows preset swaps Control and Command while preserving left and right',()=>{
 const mapper=new KeyboardMapper();
 for(const [source,target] of [['Control','Meta'],['Meta','Control'],['Alt','Alt'],['Shift','Shift']])for(const side of ['Left','Right']){
  assert.deepEqual(mapper.key(source+side,true,windows),[key(target+side,true)]);
  assert.deepEqual(mapper.key(source+side,false,windows),[key(target+side,false)]);
 }
});

test('Ctrl+C under Windows preset sends literal Mac Command and letter events',()=>{
 const mapper=new KeyboardMapper();
 assert.deepEqual(mapper.event({code:'ControlLeft',...flags({ctrlKey:true})},true,windows),[key('MetaLeft',true)]);
 assert.deepEqual(mapper.event({code:'KeyC',...flags({ctrlKey:true})},true,windows),[key('KeyC',true)]);
 assert.deepEqual(mapper.event({code:'KeyC',...flags({ctrlKey:true})},false,windows),[key('KeyC',false)]);
 assert.deepEqual(mapper.event({code:'ControlLeft',...flags()},false,windows),[key('MetaLeft',false)]);
});

test('custom mappings share one remote modifier until the last physical holder releases',()=>{
 const mapper=new KeyboardMapper(),custom={...native,Control:'Meta'};
 assert.deepEqual(mapper.key('ControlLeft',true,custom),[key('MetaLeft',true)]);
 assert.deepEqual(mapper.key('MetaLeft',true,custom),[]);
 assert.deepEqual(mapper.key('ControlLeft',false,custom),[]);
 assert.deepEqual(mapper.key('MetaLeft',false,custom),[key('MetaLeft',false)]);
 // The reverse release order must preserve the first holder too.
 assert.deepEqual(mapper.key('ControlRight',true,custom),[key('MetaRight',true)]);
 assert.deepEqual(mapper.key('MetaRight',true,custom),[]);
 assert.deepEqual(mapper.key('MetaRight',false,custom),[]);
 assert.deepEqual(mapper.key('ControlRight',false,custom),[key('MetaRight',false)]);
});

test('shared target modifier repeats never add phantom holders',()=>{
 const mapper=new KeyboardMapper(),custom={...native,Control:'Meta'};
 mapper.key('ControlLeft',true,custom);
 mapper.key('MetaLeft',true,custom);
 for(let i=0;i<5;i++){
  assert.deepEqual(mapper.key('ControlLeft',true,custom),[]);
  assert.deepEqual(mapper.key('MetaLeft',true,custom),[]);
 }
 assert.deepEqual(mapper.key('ControlLeft',false,custom),[]);
 assert.deepEqual(mapper.key('MetaLeft',false,custom),[key('MetaLeft',false)]);
});

test('disabled modifiers produce no events while ordinary letters still work',()=>{
 const mapper=new KeyboardMapper(),custom={...native,Control:'None',Alt:'None'};
 assert.deepEqual(mapper.key('ControlLeft',true,custom),[]);
 assert.deepEqual(mapper.key('ControlLeft',true,custom),[]);
 assert.deepEqual(mapper.key('AltRight',true,custom),[]);
 assert.deepEqual(mapper.key('KeyA',true,custom),[key('KeyA',true)]);
 assert.deepEqual(mapper.key('KeyA',false,custom),[key('KeyA',false)]);
 assert.deepEqual(mapper.key('ControlLeft',false,custom),[]);
 assert.deepEqual(mapper.key('AltRight',false,custom),[]);
});

test('ordinary repeated keydowns remain repeat events and release only once',()=>{
 const mapper=new KeyboardMapper();
 for(let i=0;i<4;i++)assert.deepEqual(mapper.key('ArrowDown',true,windows),[key('ArrowDown',true)]);
 assert.deepEqual(mapper.key('ArrowDown',false,windows),[key('ArrowDown',false)]);
 assert.deepEqual(mapper.key('ArrowDown',false,windows),[]);
});

test('keyup uses the destination selected on keydown even if mapping changes',()=>{
 const mapper=new KeyboardMapper();
 assert.deepEqual(mapper.key('ControlRight',true,windows),[key('MetaRight',true)]);
 assert.deepEqual(mapper.key('ControlRight',true,native),[]);
 assert.deepEqual(mapper.key('ControlRight',false,native),[key('MetaRight',false)]);
 assert.deepEqual(mapper.key('AltLeft',true,{...native,Alt:'None'}),[]);
 assert.deepEqual(mapper.key('AltLeft',false,native),[]);
 assert.deepEqual(mapper.key('AltLeft',true,native),[key('AltLeft',true)]);
 assert.deepEqual(mapper.key('AltLeft',false,{...native,Alt:'None'}),[key('AltLeft',false)]);
});

test('reset forgets released remote keys and ignores orphan keyups',()=>{
 const mapper=new KeyboardMapper();
 mapper.key('ControlLeft',true,windows);
 mapper.key('KeyC',true,windows);
 // The caller sends the protocol release event before clearing local state.
 mapper.reset();
 assert.deepEqual(mapper.key('KeyC',false,windows),[]);
 assert.deepEqual(mapper.key('ControlLeft',false,windows),[]);
 assert.deepEqual(mapper.key('MetaLeft',false,windows),[]);
 assert.deepEqual(mapper.key('',true,windows),[]);
 assert.deepEqual(mapper.key('ControlLeft',true,windows),[key('MetaLeft',true)]);
});

test('local Meta release recovers omitted letter keyups even when Meta is remapped',()=>{
 for(const mapping of [native,windows,{...native,Meta:'None'}]){
  const mapper=new KeyboardMapper();
  mapper.key('MetaLeft',true,mapping);
  mapper.key('KeyC',true,mapping);
  mapper.key('KeyV',true,mapping);
  const expected=[key('KeyC',false),key('KeyV',false)];
  if(mapping.Meta!=='None')expected.push(key(mapping.Meta+'Left',false));
  assert.deepEqual(mapper.key('MetaLeft',false,mapping),expected);
  assert.deepEqual(mapper.key('KeyC',false,mapping),[]);
  assert.deepEqual(mapper.key('KeyV',false,mapping),[]);
 }
});

test('focus or click modifier snapshots restore an already held Control key',()=>{
 const mapper=new KeyboardMapper(),held=flags({ctrlKey:true});
 assert.deepEqual(mapper.modifiers(held,windows),[key('MetaLeft',true)]);
 assert.deepEqual(mapper.modifiers(held,windows),[]);
 assert.deepEqual(mapper.event({code:'KeyC',...held},true,windows),[key('KeyC',true)]);
 assert.deepEqual(mapper.event({code:'KeyC',...held},false,windows),[key('KeyC',false)]);
 assert.deepEqual(mapper.modifiers(flags(),windows),[key('MetaLeft',false)]);
 mapper.reset();
 assert.deepEqual(mapper.modifiers(held,windows),[key('MetaLeft',true)]);
});

test('event snapshots reconcile missed modifier release before the next ordinary key',()=>{
 const mapper=new KeyboardMapper();
 mapper.key('ControlRight',true,windows);
 mapper.key('AltRight',true,windows);
 assert.deepEqual(mapper.event({code:'KeyA',...flags({shiftKey:true})},true,windows),[
  key('MetaRight',false),key('AltRight',false),key('ShiftLeft',true),key('KeyA',true),
 ]);
 assert.deepEqual(mapper.event({code:'KeyA',...flags({shiftKey:true})},false,windows),[key('KeyA',false)]);
 assert.deepEqual(mapper.modifiers(flags(),windows),[key('ShiftLeft',false)]);
});

test('modifier events retain their physical right side rather than synthesizing a left key',()=>{
 const mapper=new KeyboardMapper();
 assert.deepEqual(mapper.event({code:'ControlRight',...flags({ctrlKey:true})},true,windows),[key('MetaRight',true)]);
 assert.deepEqual(mapper.modifiers(flags({ctrlKey:true}),windows),[]);
 assert.deepEqual(mapper.event({code:'ControlRight',...flags()},false,windows),[key('MetaRight',false)]);
});

test('snapshot reconciliation restores shared targets without premature releases',()=>{
 const mapper=new KeyboardMapper(),custom={...native,Control:'Meta'};
 assert.deepEqual(mapper.modifiers(flags({ctrlKey:true,metaKey:true}),custom),[key('MetaLeft',true)]);
 assert.deepEqual(mapper.modifiers(flags({metaKey:true}),custom),[]);
 assert.deepEqual(mapper.modifiers(flags(),custom),[key('MetaLeft',false)]);
});

test('snapshot Meta release also recovers omitted letter keyup',()=>{
 const mapper=new KeyboardMapper();
 mapper.key('MetaRight',true,native);
 mapper.key('KeyC',true,native);
 assert.deepEqual(mapper.modifiers(flags(),native),[key('KeyC',false),key('MetaRight',false)]);
});

test('preset detection recognizes native, Windows swap and custom configurations',()=>{
 assert.equal(mappingPreset({...native}),'native');
 assert.equal(mappingPreset({...windows}),'windows');
 assert.equal(mappingPreset({...windows,Alt:'Control'}),'custom');
 assert.equal(mappingPreset({...native,Shift:'None'}),'custom');
});

test('valid saved settings round trip under the dedicated storage key',()=>{
 const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 const custom={...windows,Alt:'Control',Shift:'None'};
 assert.equal(writeKeyboardMapping(storage,custom),true);
 assert.deepEqual(JSON.parse(values.get(KEYBOARD_MAPPING_STORAGE)),custom);
 assert.deepEqual(readKeyboardMapping(storage),custom);
 assert.equal(mappingPreset(readKeyboardMapping(storage)),'custom');
});

test('invalid or unavailable storage falls back to an independent native mapping',()=>{
 const invalid=[null,'','{','null','[]','{}',JSON.stringify({...native,Control:'KeyC'}),JSON.stringify({...native,Meta:42}),JSON.stringify({Control:'Meta',Meta:'Control',Alt:'Alt'})];
 for(const value of invalid){
  const result=readKeyboardMapping({getItem:()=>value});
  assert.deepEqual(result,native);
  assert.notEqual(result,native);
 }
 assert.deepEqual(readKeyboardMapping({getItem(){throw new Error('storage blocked');}}),native);
 const fallback=readKeyboardMapping({getItem:()=>null});
 fallback.Control='None';
 assert.deepEqual(readKeyboardMapping({getItem:()=>null}),native);
 const savedWithExtra={...windows,unexpected:'discard me'};
 assert.deepEqual(readKeyboardMapping({getItem:()=>JSON.stringify(savedWithExtra)}),windows);
});

test('invalid mappings and blocked writes report failure without throwing',()=>{
 for(const value of [null,[],{},'native',{...native,Control:'KeyA'},{...native,Shift:undefined}])assert.equal(validKeyboardMapping(value),false);
 assert.equal(validKeyboardMapping({...native,Control:'None'}),true);
 let writes=0;
 assert.equal(writeKeyboardMapping({setItem(){writes++;}},{}),false);
 assert.equal(writes,0);
 assert.equal(writeKeyboardMapping({setItem(){throw new Error('quota exceeded');}},windows),false);
});
