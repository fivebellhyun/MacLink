'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowRight,Keyboard,Settings2,X} from 'lucide-react';
import {useLocale,LanguageSwitcher} from '@/components/locale-provider';
import {DEFAULT_KEYBOARD_MAPPING,WINDOWS_KEYBOARD_MAPPING,MODIFIER_KEYS,mappingPreset,type KeyboardMapping,type ModifierTarget} from '@/lib/keyboard-mapping';

const sourceLabels={Control:'Ctrl',Meta:'Windows / Command',Alt:'Alt / Option',Shift:'Shift'};
const targetLabels={Control:'Control ⌃',Meta:'Command ⌘',Alt:'Option ⌥',Shift:'Shift ⇧',None:'사용 안 함'};

export function RemoteSettings({open,onOpenChange,mapping,onMappingChange,saved,viewOnly,onDiagnostics}:{
 open:boolean;onOpenChange:(open:boolean)=>void;mapping:KeyboardMapping;
 onMappingChange:(value:KeyboardMapping)=>void;saved:boolean;viewOnly:boolean;onDiagnostics?:()=>Promise<string>;
}){
 const {t}=useLocale();
 const dialog=useRef<HTMLDialogElement>(null);
 const diagnosticText=useRef<HTMLTextAreaElement>(null);
 const [report,setReport]=useState(''),[diagnosing,setDiagnosing]=useState(false),[diagnosticError,setDiagnosticError]=useState(false),[copyStatus,setCopyStatus]=useState<'idle'|'copied'|'select'>('idle');
 const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const diagnose=async()=>{
  if(!onDiagnostics||diagnosing)return;
  setDiagnosing(true);setDiagnosticError(false);setCopyStatus('idle');
  try{const next=await onDiagnostics();if(mounted.current)setReport(next);}
  catch{if(mounted.current)setDiagnosticError(true);}
  finally{if(mounted.current)setDiagnosing(false);}
 };
 const copyReport=async()=>{
  try{await navigator.clipboard.writeText(report);if(mounted.current)setCopyStatus('copied');}
  catch{if(mounted.current){diagnosticText.current?.focus();diagnosticText.current?.select();setCopyStatus('select');}}
 };
 const preset=mappingPreset(mapping);
 useEffect(()=>{const el=dialog.current;if(!el)return;if(open&&!el.open)el.showModal();else if(!open&&el.open)el.close();},[open]);
 return <dialog ref={dialog} className="remote-settings" onCancel={()=>onOpenChange(false)} onClose={()=>onOpenChange(false)} aria-labelledby="remote-settings-title" aria-describedby="remote-settings-description">
  <div className="remote-settings-heading"><div><span className="remote-settings-eyebrow"><Settings2 size={13}/>{t('원격 설정')}</span><h2 id="remote-settings-title">{t('원격 연결 설정')}</h2></div><button type="button" onClick={()=>onOpenChange(false)} aria-label={t('설정 닫기')} autoFocus><X size={20}/></button></div>
  <div className="remote-settings-body">
   <div className="remote-settings-language"><label>{t('표시 언어')}</label><LanguageSwitcher/></div>
   <div className="remote-settings-section-title"><Keyboard size={20}/><div><h3>{t('키보드 매핑')}</h3><p id="remote-settings-description">{t('접속 기기의 키를 맥북에서 사용할 키로 바꿉니다.')}</p></div></div>
   {viewOnly&&<p className="remote-settings-note">{t('현재 세션은 보기 전용입니다. 키보드 설정은 원격 제어 세션에서 사용할 수 있습니다.')}</p>}
   <fieldset disabled={viewOnly}>
    <label htmlFor="keyboard-preset">{t('빠른 설정')}</label>
    <select id="keyboard-preset" value={preset} onChange={e=>{if(e.target.value==='native')onMappingChange({...DEFAULT_KEYBOARD_MAPPING});if(e.target.value==='windows')onMappingChange({...WINDOWS_KEYBOARD_MAPPING});}}>
     <option value="native">{t('기본 매핑 · 원래 키 그대로')}</option>
     <option value="windows">{t('Ctrl ↔ Command 교환 · Windows 추천')}</option>
     <option value="custom" disabled>{t('직접 지정 · 아래에서 변경')}</option>
    </select>
    {mapping.Control==='Meta'&&<div className="keyboard-mapping-example"><strong>{t('Windows 단축키를 익숙하게')}</strong><p><kbd>Ctrl</kbd> + <kbd>C</kbd><ArrowRight size={13}/><kbd>⌘</kbd> + <kbd>C</kbd></p><small>{t('복사 · 붙여넣기 · 실행 취소를 Ctrl+C / V / Z로')}</small></div>}
    <div className="keyboard-mapping-head"><span>{t('접속 기기의 키')}</span><span>{t('맥북으로 보낼 키')}</span></div>
    <div className="keyboard-mapping-list">{MODIFIER_KEYS.map(source=><div className="keyboard-mapping-row" key={source}><label htmlFor={'mapping-'+source}>{t(sourceLabels[source])}<small>{t('왼쪽 / 오른쪽 각각 적용')}</small></label><ArrowRight size={14}/><select id={'mapping-'+source} value={mapping[source]} onChange={e=>onMappingChange({...mapping,[source]:e.target.value as ModifierTarget})}>{[...MODIFIER_KEYS,'None'].map(target=><option key={target} value={target}>{t(targetLabels[target as ModifierTarget])}</option>)}</select></div>)}</div>
    <button type="button" className="keyboard-reset" onClick={()=>onMappingChange({...DEFAULT_KEYBOARD_MAPPING})}>{t('기본값으로 되돌리기')}</button>
   </fieldset>
   <p className="remote-settings-note">{t('화면을 클릭하면 변경한 설정으로 입력합니다. Shift + Esc로 입력을 해제할 수 있습니다. 상단의 ⌘C · ⌘V · ⌘Tab 버튼은 항상 Mac 단축키를 보냅니다.')}</p>
   <p className="remote-settings-note">{t('Windows 키 조합, Alt+Tab 등 운영체제나 브라우저가 먼저 처리하는 단축키는 전달되지 않을 수 있습니다.')}</p>
   {onDiagnostics&&<section className="connection-diagnostics" aria-labelledby="connection-diagnostics-title">
    <h3 id="connection-diagnostics-title">{t('연결 진단')}</h3>
    <p className="remote-settings-note">{t('연결 상태와 최근 복구 기록을 확인합니다. IP 주소, 접속 링크, 화면 및 입력 내용은 포함하지 않으며 자동으로 전송하거나 저장하지 않습니다.')}</p>
    <button type="button" className="keyboard-reset" disabled={diagnosing} onClick={()=>void diagnose()}>{t(diagnosing?'진단 확인 중…':report?'연결 진단 새로고침':'연결 진단 보기')}</button>
    {diagnosticError&&<p role="status" className="remote-settings-note">{t('연결 진단을 표시할 수 없습니다. 다시 시도하세요.')}</p>}
    {report&&<><label htmlFor="connection-diagnostics-report">{t('연결 진단 결과')}</label><textarea ref={diagnosticText} id="connection-diagnostics-report" readOnly value={report} spellCheck={false}/><button type="button" className="keyboard-reset" onClick={()=>void copyReport()}>{t('진단 결과 복사')}</button><p role="status" className="remote-settings-note">{copyStatus==='copied'?t('진단 결과를 복사했습니다.'):copyStatus==='select'?t('자동 복사가 불가능하여 내용을 선택했습니다. Ctrl+C 또는 Command+C로 복사하세요.'):t('문제 확인이 필요할 때 진단 결과를 복사하여 공유할 수 있습니다.')}</p></>}
   </section>}
  </div>
  <div className="remote-settings-footer"><span role="status">{t(saved?'이 브라우저에 자동 저장됩니다.':'브라우저에 저장할 수 없어 이번 접속에만 적용됩니다.')}</span><button type="button" onClick={()=>onOpenChange(false)}>{t('완료')}</button></div>
 </dialog>;
}
