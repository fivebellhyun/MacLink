import {legalDocuments,LEGAL_EMAIL,LEGAL_OPERATOR,LEGAL_EFFECTIVE_DATE,LEGAL_UPDATED_DATE,type LegalKind,type LegalLanguage} from '@/lib/legal-content';
import './legal-document.css';
export function LegalDocument({kind,language}:{kind:LegalKind;language:LegalLanguage}){
 const content=legalDocuments[kind][language],english=language==='en';
 return <main className="legal-shell" lang={language}>
  <header className="legal-topbar"><a className="legal-brand" href="/">MacLink<span>.</span></a><nav aria-label={english?'Document language':'문서 언어'}><a href={'/'+kind+'?lang=ko'} aria-current={!english?'page':undefined}>한국어</a><a href={'/'+kind+'?lang=en'} aria-current={english?'page':undefined}>English</a></nav></header>
  <article className="legal-paper">
   <div className="legal-heading"><p className="legal-eyebrow">MacLink / {english?'Trust & policies':'서비스 정책'}</p><h1>{content.title}</h1><p className="legal-subtitle">{content.subtitle}</p><div className="legal-meta"><span>{english?'Effective':'시행일'} <time dateTime={LEGAL_EFFECTIVE_DATE}>{LEGAL_EFFECTIVE_DATE}</time></span><span>{english?'Updated':'최종 수정일'} <time dateTime={LEGAL_UPDATED_DATE}>{LEGAL_UPDATED_DATE}</time></span><span>{english?'Operator':'운영자'} {LEGAL_OPERATOR}</span></div></div>
   <aside className="legal-summary" aria-label={english?'At a glance':'주요 내용'}><strong>{english?'At a glance':'먼저 확인하세요'}</strong><ul>{content.summary.map(text=><li key={text}>{text}</li>)}</ul></aside>
   <nav className="legal-contents" aria-label={english?'Contents':'목차'}>{content.sections.map(section=><a key={section.id} href={'#'+section.id}>{section.title}</a>)}</nav>
   {content.sections.map(section=><section className="legal-section" id={section.id} key={section.id}><h2>{section.title}</h2>{section.paragraphs?.map(text=><p key={text}>{text}</p>)}{section.bullets&&<ul>{section.bullets.map(text=><li key={text}>{text}</li>)}</ul>}{section.table&&<div className="legal-table-scroll"><table><thead><tr>{section.table.headers.map(header=><th scope="col" key={header}>{header}</th>)}</tr></thead><tbody>{section.table.rows.map((row,index)=><tr key={index}>{row.map((cell,column)=><td key={column}>{cell}</td>)}</tr>)}</tbody></table></div>}{section.links&&<div className="legal-references">{section.links.map(link=><a key={link.href} href={link.href} {...(link.href.startsWith('https:')?{target:'_blank',rel:'noreferrer'}:{})}>{link.label}<span aria-hidden="true"> ↗</span></a>)}</div>}</section>)}
   <section className="legal-contact"><h2>{english?'Questions or a privacy request?':'문의 또는 개인정보 권리 요청'}</h2><p>{english?'Contact the operator without including passwords, raw keys or private screen content.':'비밀번호·연결 키 원문·민감한 화면을 첨부하지 말고 담당자에게 문의해 주세요.'}</p><a href={'mailto:'+LEGAL_EMAIL}>{LEGAL_EMAIL}<span aria-hidden="true"> ↗</span></a></section>
   <footer className="legal-footer"><a href="/">{english?'Back to MacLink':'MacLink로 돌아가기'}</a><a href={'/privacy?lang='+language}>{english?'Privacy Policy':'개인정보 처리방침'}</a><a href={'/terms?lang='+language}>{english?'Terms of Service':'서비스 약관'}</a></footer>
  </article>
 </main>;
}
