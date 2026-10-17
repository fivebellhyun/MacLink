import type {Metadata} from 'next';
import {LegalDocument} from '@/components/legal-document';
export const metadata:Metadata={title:"개인정보 처리방침 / Privacy Policy — MacLink",description:'MacLink legal information. Operator: 오종현. Contact: taoss3932@gmail.com.',alternates:{canonical:'https://www.maclink.cloud/privacy',languages:{ko:'https://www.maclink.cloud/privacy?lang=ko',en:'https://www.maclink.cloud/privacy?lang=en'}}};
export default async function Page({searchParams}:{searchParams:Promise<{lang?:string}>}){
 const query=await searchParams;
 return <LegalDocument kind="privacy" language={query?.lang==='en'?'en':'ko'}/>;
}
