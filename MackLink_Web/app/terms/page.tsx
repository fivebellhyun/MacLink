import type {Metadata} from 'next';
import {LegalDocument} from '@/components/legal-document';
export const metadata:Metadata={title:"서비스 약관 / Terms of Service — MacLink",description:'MacLink legal information. Operator: 오종현. Contact: taoss3932@gmail.com.',alternates:{canonical:'https://www.maclink.cloud/terms',languages:{ko:'https://www.maclink.cloud/terms?lang=ko',en:'https://www.maclink.cloud/terms?lang=en'}}};
export default async function Page({searchParams}:{searchParams:Promise<{lang?:string}>}){
 const query=await searchParams;
 return <LegalDocument kind="terms" language={query?.lang==='en'?'en':'ko'}/>;
}
