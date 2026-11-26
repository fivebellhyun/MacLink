/** How a touch-first device drives the remote pointer. Stored in this browser only. */
export type TouchInputMode='touch'|'joystick';
export const DEFAULT_TOUCH_INPUT_MODE:TouchInputMode='joystick';
export const TOUCH_INPUT_MODE_STORAGE='maclink.touch-input-mode.v1';
export const isTouchInputMode=(value:unknown):value is TouchInputMode=>value==='touch'||value==='joystick';

export function readTouchInputMode(storage:Pick<Storage,'getItem'>):TouchInputMode{
 try{const value=storage.getItem(TOUCH_INPUT_MODE_STORAGE);if(isTouchInputMode(value))return value;}catch{}
 return DEFAULT_TOUCH_INPUT_MODE;
}
export function writeTouchInputMode(storage:Pick<Storage,'setItem'>,mode:TouchInputMode){
 try{storage.setItem(TOUCH_INPUT_MODE_STORAGE,mode);return true;}catch{return false;}
}

/**
 * Touch mode: the screen behaves like a touchscreen (tap clicks, drag drags).
 * Joystick mode: a finger on the screen only aims the pointer and clicks come from the round
 * buttons, so brushing the screen next to the controls never clicks. A mouse or pen always clicks.
 */
export function screenTouchAimsOnly(mode:TouchInputMode,pointerType:string){
 return mode==='joystick'&&pointerType==='touch';
}
