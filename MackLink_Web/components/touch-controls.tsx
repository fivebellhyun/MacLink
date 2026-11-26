'use client';
import {useCallback,useEffect,useRef,type PointerEvent as ReactPointerEvent} from 'react';
import {Check,ChevronDown,ChevronUp} from 'lucide-react';
import {useLocale} from '@/components/locale-provider';
import {stickVector,WheelAccumulator,WHEEL_DRAG_GAIN,WHEEL_STEP,type Stick,type VirtualCursor} from '@/lib/virtual-pointer';

/** The remote screen's displayed area, in pixels relative to the controls' container. */
export type ScreenRect={left:number;top:number;width:number;height:number};
type MouseButton=0|2;
type Props={
 cursor:VirtualCursor;
 screen:()=>ScreenRect|null;
 disabled:boolean;
 onMove:(x:number,y:number)=>void;
 /** Returns false when input is not currently allowed. */
 onButton:(button:MouseButton,down:boolean)=>boolean;
 /** Scroll by `dy` remote pixels; positive scrolls down. */
 onWheel:(dy:number)=>void;
};
type StickState={pointer:number;cx:number;cy:number;radius:number;vector:Stick};
type WheelRepeat={pointer:number;element:HTMLElement;delay:ReturnType<typeof setTimeout>;timer:ReturnType<typeof setInterval>|null};

/** Share of the stick base's radius the knob can travel. */
const KNOB_TRAVEL=0.62;
/** Holding ▲/▼ starts repeating after this delay, then ticks at this interval. */
const WHEEL_REPEAT_DELAY=350,WHEEL_REPEAT_MS=60;
const swallow=(e:ReactPointerEvent)=>{e.preventDefault();e.stopPropagation();};
const stop=(e:{stopPropagation:()=>void})=>e.stopPropagation();

/**
 * On-screen joystick (bottom left), round A/B click buttons (bottom right) and a scroll wheel
 * (right edge, middle) for touch devices. The Mac's cursor is not part of the video, so a local
 * marker shows the pointer.
 */
export function TouchControls({cursor,screen,disabled,onMove,onButton,onWheel}:Props){
 const {t}=useLocale();
 const base=useRef<HTMLDivElement>(null),knob=useRef<HTMLSpanElement>(null),mark=useRef<HTMLDivElement>(null);
 const buttons=useRef<Record<MouseButton,HTMLButtonElement|null>>({0:null,2:null});
 const stick=useRef<StickState|null>(null),frame=useRef(0),last=useRef(0),held=useRef(new Map<number,MouseButton>());
 const latest=useRef({screen,onMove,onButton,onWheel});latest.current={screen,onMove,onButton,onWheel};
 const wheel=useRef(new WheelAccumulator()),wheelFrame=useRef(0),grip=useRef<HTMLButtonElement>(null);
 const wheelDrag=useRef<{pointer:number;y:number}|null>(null),wheelOffset=useRef(0),wheelRepeat=useRef<WheelRepeat|null>(null);
 // Pressed styling is applied directly, like the knob position, to avoid re-rendering on every touch.
 const showPressed=useCallback(()=>{
  const active=new Set(held.current.values());
  for(const button of [0,2] as const)buttons.current[button]?.classList.toggle('active',active.has(button));
  mark.current?.classList.toggle('pressed',active.size>0);
 },[]);

 const place=useCallback(()=>{
  const element=mark.current,rect=latest.current.screen();if(!element)return;
  if(!rect||!(rect.width>0)||!(rect.height>0)){element.style.visibility='hidden';return;}
  element.style.visibility='visible';
  element.style.transform=`translate3d(${rect.left+cursor.x*rect.width}px,${rect.top+cursor.y*rect.height}px,0)`;
 },[cursor]);

 const endStick=useCallback(()=>{
  const state=stick.current;stick.current=null;
  if(frame.current)cancelAnimationFrame(frame.current);frame.current=0;
  if(knob.current)knob.current.style.transform='';
  base.current?.classList.remove('active');
  if(state&&base.current?.hasPointerCapture(state.pointer))base.current.releasePointerCapture(state.pointer);
 },[]);

 const releaseButtons=useCallback(()=>{
  for(const button of new Set(held.current.values()))latest.current.onButton(button,false);
  held.current.clear();showPressed();
 },[showPressed]);

 useEffect(()=>{
  place();
  const unsubscribe=cursor.subscribe(place);
  const container=mark.current?.parentElement;
  const observer=typeof ResizeObserver==='function'&&container?new ResizeObserver(place):null;
  if(observer&&container)observer.observe(container);
  window.addEventListener('resize',place);
  return()=>{unsubscribe();observer?.disconnect();window.removeEventListener('resize',place);};
 },[cursor,place]);

 // Wheel movement is coalesced per animation frame so a fast drag sends a few events, not dozens.
 const flushWheel=useCallback(()=>{
  wheelFrame.current=0;
  for(let dy=wheel.current.take();dy!==0;dy=wheel.current.take())latest.current.onWheel(dy);
 },[]);
 const queueWheel=useCallback((dy:number)=>{
  wheel.current.add(dy);
  if(!wheelFrame.current)wheelFrame.current=requestAnimationFrame(flushWheel);
 },[flushWheel]);
 const stopWheelRepeat=useCallback(()=>{
  const repeat=wheelRepeat.current;wheelRepeat.current=null;if(!repeat)return;
  clearTimeout(repeat.delay);if(repeat.timer)clearInterval(repeat.timer);
  repeat.element.classList.remove('active');
  if(repeat.element.hasPointerCapture(repeat.pointer))repeat.element.releasePointerCapture(repeat.pointer);
 },[]);
 const endWheelDrag=useCallback(()=>{
  const drag=wheelDrag.current;wheelDrag.current=null;grip.current?.classList.remove('active');
  if(drag&&grip.current?.hasPointerCapture(drag.pointer))grip.current.releasePointerCapture(drag.pointer);
 },[]);
 const endWheel=useCallback(()=>{
  stopWheelRepeat();endWheelDrag();
  if(wheelFrame.current)cancelAnimationFrame(wheelFrame.current);wheelFrame.current=0;wheel.current.reset();
 },[stopWheelRepeat,endWheelDrag]);

 // Never leave a button held, the pointer drifting or the wheel spinning once input pauses or the controls hide.
 useEffect(()=>{if(disabled){endStick();releaseButtons();endWheel();}},[disabled,endStick,releaseButtons,endWheel]);
 useEffect(()=>()=>{endStick();releaseButtons();endWheel();},[endStick,releaseButtons,endWheel]);

 function tick(now:number){
  const state=stick.current;if(!state){frame.current=0;return;}
  const elapsed=now-last.current;last.current=now;
  const rect=latest.current.screen();
  if(rect&&rect.width>0&&rect.height>0&&cursor.step(state.vector,elapsed,rect.width/rect.height))latest.current.onMove(cursor.x,cursor.y);
  frame.current=requestAnimationFrame(tick);
 }
 function aim(e:ReactPointerEvent){
  const state=stick.current;if(!state||e.pointerId!==state.pointer)return;
  const dx=e.clientX-state.cx,dy=e.clientY-state.cy,distance=Math.hypot(dx,dy),scale=distance>state.radius?state.radius/distance:1;
  state.vector=stickVector(dx,dy,state.radius);
  if(knob.current)knob.current.style.transform=`translate(${dx*scale}px,${dy*scale}px)`;
 }
 function stickDown(e:ReactPointerEvent<HTMLDivElement>){
  swallow(e);if(disabled||stick.current)return;
  const rect=e.currentTarget.getBoundingClientRect();
  stick.current={pointer:e.pointerId,cx:rect.left+rect.width/2,cy:rect.top+rect.height/2,radius:rect.width/2*KNOB_TRAVEL,vector:{x:0,y:0}};
  e.currentTarget.setPointerCapture(e.pointerId);e.currentTarget.classList.add('active');
  aim(e);last.current=performance.now();
  if(!frame.current)frame.current=requestAnimationFrame(tick);
 }
 function stickMove(e:ReactPointerEvent){if(stick.current?.pointer===e.pointerId){swallow(e);aim(e);}}
 function stickUp(e:ReactPointerEvent){if(stick.current?.pointer===e.pointerId){swallow(e);endStick();}}

 function buttonDown(button:MouseButton,e:ReactPointerEvent<HTMLButtonElement>){
  swallow(e);if(disabled||held.current.has(e.pointerId))return;
  if(![...held.current.values()].includes(button)&&!latest.current.onButton(button,true))return;
  held.current.set(e.pointerId,button);e.currentTarget.setPointerCapture(e.pointerId);showPressed();
  navigator.vibrate?.(8);
 }
 function buttonUp(e:ReactPointerEvent<HTMLButtonElement>){
  const button=held.current.get(e.pointerId);if(button===undefined)return;
  swallow(e);held.current.delete(e.pointerId);
  // Another finger may still hold the same button; only the last release lifts it on the Mac.
  if(![...held.current.values()].includes(button))latest.current.onButton(button,false);
  showPressed();
 }
 // Dragging the wheel's ridges scrolls like a mouse wheel: finger down scrolls down.
 function gripDown(e:ReactPointerEvent<HTMLButtonElement>){
  swallow(e);if(disabled||wheelDrag.current)return;
  wheelDrag.current={pointer:e.pointerId,y:e.clientY};
  e.currentTarget.setPointerCapture(e.pointerId);e.currentTarget.classList.add('active');
 }
 function gripMove(e:ReactPointerEvent<HTMLButtonElement>){
  const drag=wheelDrag.current;if(!drag||drag.pointer!==e.pointerId)return;
  swallow(e);const delta=e.clientY-drag.y;drag.y=e.clientY;if(!delta)return;
  wheelOffset.current+=delta;e.currentTarget.style.backgroundPositionY=`${wheelOffset.current}px`;
  queueWheel(delta*WHEEL_DRAG_GAIN);
 }
 function gripUp(e:ReactPointerEvent){if(wheelDrag.current?.pointer===e.pointerId){swallow(e);endWheelDrag();}}
 // ▲/▼ scroll one step per tap and keep scrolling while held.
 function stepDown(direction:1|-1,e:ReactPointerEvent<HTMLButtonElement>){
  swallow(e);if(disabled||wheelRepeat.current)return;
  const element=e.currentTarget;element.setPointerCapture(e.pointerId);element.classList.add('active');
  queueWheel(direction*WHEEL_STEP);navigator.vibrate?.(5);
  const repeat:WheelRepeat={pointer:e.pointerId,element,timer:null,delay:setTimeout(()=>{
   if(wheelRepeat.current===repeat)repeat.timer=setInterval(()=>queueWheel(direction*WHEEL_STEP),WHEEL_REPEAT_MS);
  },WHEEL_REPEAT_DELAY)};
  wheelRepeat.current=repeat;
 }
 function stepUp(e:ReactPointerEvent){if(wheelRepeat.current?.pointer===e.pointerId){swallow(e);stopWheelRepeat();}}
 const stepEvents=(direction:1|-1)=>({
  onPointerDown:(e:ReactPointerEvent<HTMLButtonElement>)=>stepDown(direction,e),
  onPointerUp:stepUp,onPointerCancel:stepUp,onLostPointerCapture:stepUp,
 });

 const buttonEvents=(button:MouseButton)=>({
  onPointerDown:(e:ReactPointerEvent<HTMLButtonElement>)=>buttonDown(button,e),
  onPointerUp:buttonUp,onPointerCancel:buttonUp,onLostPointerCapture:buttonUp,
 });

 // Events stay inside the controls so the screen does not treat them as taps or release input.
 return <div className="touch-controls" aria-disabled={disabled} onPointerDown={stop} onPointerMove={stop} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop} onContextMenu={e=>{e.preventDefault();e.stopPropagation();}}>
  <div ref={mark} className="touch-cursor" aria-hidden="true">
   <svg viewBox="0 0 18 26" focusable="false"><path d="M1.5 1.5v19.2l5-4.9 3.3 7.6 3.1-1.3-3.3-7.5h7z" fill="#fff" stroke="#0d130f" strokeWidth="1.6" strokeLinejoin="round"/></svg>
  </div>
  <div ref={base} className="touch-stick" role="group" aria-label={t('포인터 이동 조이스틱')} onPointerDown={stickDown} onPointerMove={stickMove} onPointerUp={stickUp} onPointerCancel={stickUp} onLostPointerCapture={stickUp}>
   <span ref={knob} className="touch-stick-knob" aria-hidden="true"/>
  </div>
  <div className="touch-buttons">
   <button ref={element=>{buttons.current[2]=element;}} type="button" tabIndex={-1} className="touch-button secondary" aria-label={t('우클릭')} title={t('우클릭')} {...buttonEvents(2)}>B</button>
   <button ref={element=>{buttons.current[0]=element;}} type="button" tabIndex={-1} className="touch-button primary" aria-label={t('좌클릭')} title={t('좌클릭')} {...buttonEvents(0)}>A</button>
  </div>
  <div className="touch-wheel" role="group" aria-label={t('휠 스크롤')}>
   <button type="button" tabIndex={-1} className="touch-wheel-step" aria-label={t('위로 스크롤')} title={t('위로 스크롤')} {...stepEvents(-1)}><ChevronUp size={18} strokeWidth={2.6} aria-hidden="true"/></button>
   {/* A button, like ▲/▼, so mobile touch adjustment keeps a touch near its edge on the grip. */}
   <button ref={grip} type="button" tabIndex={-1} className="touch-wheel-grip" aria-label={t('휠을 위아래로 끌어 스크롤')} onPointerDown={gripDown} onPointerMove={gripMove} onPointerUp={gripUp} onPointerCancel={gripUp} onLostPointerCapture={gripUp}/>
   <button type="button" tabIndex={-1} className="touch-wheel-step" aria-label={t('아래로 스크롤')} title={t('아래로 스크롤')} {...stepEvents(1)}><ChevronDown size={18} strokeWidth={2.6} aria-hidden="true"/></button>
  </div>
 </div>;
}

/** Toolbar check button that shows or hides the joystick and A/B buttons; taps always click. */
export function JoystickToggle({enabled,onChange}:{enabled:boolean;onChange:(enabled:boolean)=>void}){
 const {t}=useLocale();
 return <button type="button" role="checkbox" aria-checked={enabled} className="joystick-toggle" title={t(enabled?'조이스틱 숨기기':'조이스틱 표시')} onClick={()=>onChange(!enabled)}>
  <span className="joystick-check" aria-hidden="true">{enabled&&<Check size={12} strokeWidth={3.2}/>}</span><span>{t('조이스틱')}</span>
 </button>;
}
