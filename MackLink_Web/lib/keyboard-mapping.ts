export const MODIFIER_KEYS = ['Control', 'Meta', 'Alt', 'Shift'] as const;
export type ModifierKey = typeof MODIFIER_KEYS[number];
export type ModifierTarget = ModifierKey | 'None';
export type KeyboardMapping = Record<ModifierKey, ModifierTarget>;
export const DEFAULT_KEYBOARD_MAPPING: KeyboardMapping = {Control:'Control', Meta:'Meta', Alt:'Alt', Shift:'Shift'};
export const WINDOWS_KEYBOARD_MAPPING: KeyboardMapping = {Control:'Meta', Meta:'Control', Alt:'Alt', Shift:'Shift'};
export const KEYBOARD_MAPPING_STORAGE = 'maclink.keyboard-mapping.v1';
export type RemoteKey = {type:'key'; code:string; down:boolean};
export type ModifierSnapshot = {ctrlKey:boolean; metaKey:boolean; altKey:boolean; shiftKey:boolean};
const flags = {Control:'ctrlKey', Meta:'metaKey', Alt:'altKey', Shift:'shiftKey'} as const;

function modifier(code:string): ModifierKey | undefined {
 return MODIFIER_KEYS.find(key => code === key+'Left' || code === key+'Right');
}
export function validKeyboardMapping(value:unknown): value is KeyboardMapping {
 if(!value || typeof value!=='object' || Array.isArray(value))return false;
 return MODIFIER_KEYS.every(key => [...MODIFIER_KEYS,'None'].includes((value as KeyboardMapping)[key]));
}
export function readKeyboardMapping(storage:Pick<Storage,'getItem'>):KeyboardMapping {
 try{const value:unknown=JSON.parse(storage.getItem(KEYBOARD_MAPPING_STORAGE)||'null');if(validKeyboardMapping(value))return Object.fromEntries(MODIFIER_KEYS.map(key=>[key,value[key]])) as KeyboardMapping;}catch{}
 return {...DEFAULT_KEYBOARD_MAPPING};
}
export function writeKeyboardMapping(storage:Pick<Storage,'setItem'>,mapping:KeyboardMapping):boolean {
 if(!validKeyboardMapping(mapping))return false;
 try{storage.setItem(KEYBOARD_MAPPING_STORAGE,JSON.stringify(mapping));return true;}catch{return false;}
}
export function mappingPreset(mapping:KeyboardMapping):'native'|'windows'|'custom' {
 if(MODIFIER_KEYS.every(key=>mapping[key]===DEFAULT_KEYBOARD_MAPPING[key]))return 'native';
 if(MODIFIER_KEYS.every(key=>mapping[key]===WINDOWS_KEYBOARD_MAPPING[key]))return 'windows';
 return 'custom';
}

// Remember the destination from keydown until keyup, including shared targets.
// All events leaving this class use the existing native input protocol.
export class KeyboardMapper {
 private pressed = new Map<string,string|null>();
 reset(){this.pressed.clear();}
 key(code:string,down:boolean,mapping:KeyboardMapping):RemoteKey[] {
  if(!code)return [];
  if(down){
   if(this.pressed.has(code)){const target=this.pressed.get(code);return target&&!modifier(code)?[{type:'key',code:target,down:true}]:[];}
   const source=modifier(code),target=source?(mapping[source]==='None'?null:mapping[source]+(code.endsWith('Right')?'Right':'Left')):code;
   const shared=target&&[...this.pressed.values()].includes(target);this.pressed.set(code,target);
   return target&&!shared?[{type:'key',code:target,down:true}]:[];
  }
  const events:RemoteKey[]=[];
  // macOS browsers can omit the letter's keyup while local Command is held.
  if(modifier(code)==='Meta')for(const held of [...this.pressed.keys()])if(!modifier(held))events.push(...this.release(held));
  return [...events,...this.release(code)];
 }
 private release(code:string):RemoteKey[] {
  const target=this.pressed.get(code);this.pressed.delete(code);
  return target&&![...this.pressed.values()].includes(target)?[{type:'key',code:target,down:false}]:[];
 }
 modifiers(snapshot:ModifierSnapshot,mapping:KeyboardMapping):RemoteKey[] {
  const events:RemoteKey[]=[];
  for(const source of MODIFIER_KEYS){
   const held=[...this.pressed.keys()].filter(code=>modifier(code)===source);
   if(!snapshot[flags[source]])for(const code of held)events.push(...this.key(code,false,mapping));
   else if(!held.length)events.push(...this.key(source+'Left',true,mapping));
  }
  return events;
 }
 event(event:ModifierSnapshot&{code:string},down:boolean,mapping:KeyboardMapping):RemoteKey[] {
  return modifier(event.code)?[...this.key(event.code,down,mapping),...this.modifiers(event,mapping)]:[...this.modifiers(event,mapping),...this.key(event.code,down,mapping)];
 }
}
