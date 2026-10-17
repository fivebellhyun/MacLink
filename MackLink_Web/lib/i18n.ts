import {homeMessages} from './locales/home.ts';
import {remoteMessages} from './locales/remote.ts';
import {networkMessages} from './locales/network.ts';
import {apiMessages} from './locales/api.ts';

export type Locale='ko'|'en';
export type MessageParams=Record<string,string|number>;
export const LOCALE_STORAGE_KEY='maclink.locale.v1';
export const commonMessages:Record<string,string>={
 '언어':'Language',
 '언어 설정':'Language settings',
 'MacLink — 어디서든, 내 맥으로':'MacLink — MacBook remote access, anywhere',
 '빠르게':'Fast',
 '균형':'Balanced',
 '선명하게':'Sharp',
 '최고':'Ultra',
};
export const messages:Readonly<Record<string,string>>={...homeMessages,...remoteMessages,...networkMessages,...apiMessages,...commonMessages};
const koreanByEnglish=new Map(Object.entries(messages).map(([ko,en])=>[en,ko]));

export function normalizeLocale(value:unknown):Locale|null {
 if(typeof value!=='string')return null;
 const language=value.toLowerCase().split(/[-_]/)[0];
 return language==='ko'||language==='en'?language:null;
}
export function preferredLocale(saved:unknown,languages:readonly string[]):Locale {
 const explicit=normalizeLocale(saved);if(explicit)return explicit;
 for(const language of languages){const locale=normalizeLocale(language);if(locale)return locale;}
 return 'en';
}
function interpolate(message:string,params:MessageParams):string {
 // Function replacement keeps user names containing '$&' or '$1' literal.
 return message.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g,(whole,key:string)=>Object.hasOwn(params,key)?String(params[key]):whole);
}
export function translateMessage(message:string,locale:Locale,params:MessageParams={}):string {
 const source=locale==='en'?(Object.hasOwn(messages,message)?messages[message]:message):(koreanByEnglish.get(message)??message);
 if(source!==message||Object.hasOwn(messages,message)||koreanByEnglish.has(message))return interpolate(source,params);
 // Runtime diagnostics can include an error code; translate only known templates.
 for(const [ko,en] of Object.entries(messages)){
  if(!ko.includes('{code}')&&!en.includes('{code}'))continue;
  const template=locale==='en'?ko:en;
  const pattern=template.split('{code}').map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('([0-9]+)');
  const match=message.match(new RegExp('^'+pattern+'$'));
  if(match)return interpolate(locale==='en'?en:ko,{...params,code:match[1]});
 }
 return interpolate(source,params);
}
