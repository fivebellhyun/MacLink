/**
 * Touch-first devices always click by tapping the screen. Joystick mode also shows the on-screen
 * joystick and round click buttons; touch mode hides them. Stored in this browser only.
 */
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
