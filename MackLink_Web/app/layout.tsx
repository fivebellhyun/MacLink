import type { Metadata } from 'next';
import './globals.css';
import {LocaleProvider} from '@/components/locale-provider';
export const metadata: Metadata = {
 title:'MacLink — 어디서든, 내 맥으로',
 description:'MacBook remote access with WebRTC and TURN/TLS. 브라우저에서 내 맥북의 화면을 보고 키보드·마우스를 제어하세요. 한국어 · English.',
 icons:{icon:'/favicon.svg'}, referrer:'no-referrer',
};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="ko"><head><script src="/browser-compat.js"/></head><body><LocaleProvider>{children}</LocaleProvider></body></html>;}
