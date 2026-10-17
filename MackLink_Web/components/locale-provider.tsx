'use client';
import {createContext,useCallback,useContext,useEffect,useState,type ReactNode} from 'react';
import {Languages} from 'lucide-react';
import {LOCALE_STORAGE_KEY,preferredLocale,translateMessage,type Locale,type MessageParams} from '@/lib/i18n';

type LocaleContextValue={locale:Locale;setLocale:(locale:Locale)=>void;t:(message:string,params?:MessageParams)=>string};
const LocaleContext=createContext<LocaleContextValue|null>(null);

export function LocaleProvider({children}:{children:ReactNode}){
 const [locale,updateLocale]=useState<Locale>('ko');
 useEffect(()=>{
  let saved:string|null=null;try{saved=localStorage.getItem(LOCALE_STORAGE_KEY);}catch{}
  updateLocale(preferredLocale(saved,navigator.languages?.length?navigator.languages:[navigator.language]));
 },[]);
 useEffect(()=>{
  document.documentElement.lang=locale;
  if(window.location.pathname==='/')document.title=translateMessage('MacLink — 어디서든, 내 맥으로',locale);
 },[locale]);
 const setLocale=useCallback((value:Locale)=>{if(value!=='ko'&&value!=='en')return;updateLocale(value);try{localStorage.setItem(LOCALE_STORAGE_KEY,value);}catch{}},[]);
 const t=useCallback((message:string,params:MessageParams={})=>translateMessage(message,locale,params),[locale]);
 return <LocaleContext.Provider value={{locale,setLocale,t}}>{children}</LocaleContext.Provider>;
}
export function useLocale(){const context=useContext(LocaleContext);if(!context)throw new Error('useLocale requires LocaleProvider');return context;}
export function LanguageSwitcher(){
 const {locale,setLocale,t}=useLocale();
 return <label className="language-switcher"><Languages size={16} aria-hidden="true"/><span className="sr-only">{t('언어 설정')}</span><select value={locale} onChange={event=>setLocale(event.target.value as Locale)} aria-label={t('언어')}><option value="ko">한국어</option><option value="en">English</option></select></label>;
}
