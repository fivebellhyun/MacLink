/** Touch joystick math for the remote pointer. Positions are normalized to the remote screen (0–1). */
export type Stick={x:number;y:number};

/** Share of the stick radius that is ignored so a resting thumb does not drift the pointer. */
export const JOYSTICK_DEADZONE=0.12;
/** Full deflection moves the pointer this many remote-screen widths per second. */
export const JOYSTICK_MAX_SPEED=0.9;
/** A late animation frame (background tab, slow device) never jumps further than this. */
const MAX_STEP_MS=50;
const clamp=(value:number)=>Math.min(1,Math.max(0,value));

/** Map a thumb offset from the stick centre to a vector inside the unit circle, with a dead zone. */
export function stickVector(dx:number,dy:number,radius:number):Stick{
 if(!(radius>0)||!Number.isFinite(dx)||!Number.isFinite(dy))return {x:0,y:0};
 const length=Math.hypot(dx,dy),distance=length/radius;
 if(distance<=JOYSTICK_DEADZONE)return {x:0,y:0};
 const magnitude=Math.min(1,(distance-JOYSTICK_DEADZONE)/(1-JOYSTICK_DEADZONE));
 return {x:dx/length*magnitude,y:dy/length*magnitude};
}

/** Pointer position driven by the joystick and by direct taps on the remote screen. */
export class VirtualCursor {
 x=0.5;
 y=0.5;
 private listeners=new Set<()=>void>();
 /** Returns true when the position changed. */
 set(x:number,y:number){
  if(!Number.isFinite(x)||!Number.isFinite(y))return false;
  const nextX=clamp(x),nextY=clamp(y);
  if(nextX===this.x&&nextY===this.y)return false;
  this.x=nextX;this.y=nextY;this.changed();return true;
 }
 /**
  * Advance by a stick vector over `elapsedMs`. `aspect` is the remote screen's width / height, so a
  * diagonal moves the same distance in pixels on both axes. Speed rises with the square of the
  * deflection: small tilts stay precise while a full tilt crosses the screen quickly.
  */
 step(stick:Stick,elapsedMs:number,aspect:number){
  const magnitude=Math.hypot(stick.x,stick.y);
  if(!(magnitude>0)||!(elapsedMs>0)||!(aspect>0)||!Number.isFinite(aspect))return false;
  const widths=JOYSTICK_MAX_SPEED*Math.min(1,magnitude)**2*Math.min(elapsedMs,MAX_STEP_MS)/1000;
  return this.set(this.x+stick.x/magnitude*widths,this.y+stick.y/magnitude*widths*aspect);
 }
 /** Notify listeners, e.g. after the remote screen size or layout changed. */
 changed(){for(const listener of this.listeners)listener();}
 subscribe(listener:()=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
}
