"""Input validation shared by transport adapters. No shell/command execution."""
import math
KEYS = {
 'KeyA':0,'KeyS':1,'KeyD':2,'KeyF':3,'KeyH':4,'KeyG':5,'KeyZ':6,'KeyX':7,'KeyC':8,'KeyV':9,'KeyB':11,
 'KeyQ':12,'KeyW':13,'KeyE':14,'KeyR':15,'KeyY':16,'KeyT':17,'Digit1':18,'Digit2':19,'Digit3':20,'Digit4':21,
 'Digit6':22,'Digit5':23,'Equal':24,'Digit9':25,'Digit7':26,'Minus':27,'Digit8':28,'Digit0':29,'BracketRight':30,
 'KeyO':31,'KeyU':32,'BracketLeft':33,'KeyI':34,'KeyP':35,'Enter':36,'KeyL':37,'KeyJ':38,'Quote':39,'KeyK':40,
 'Semicolon':41,'Backslash':42,'Comma':43,'Slash':44,'KeyN':45,'KeyM':46,'Period':47,'Tab':48,'Space':49,
 'Backquote':50,'Backspace':51,'Escape':53,'MetaRight':54,'MetaLeft':55,'ShiftLeft':56,'CapsLock':57,
 'AltLeft':58,'ControlLeft':59,'ShiftRight':60,'AltRight':61,'ControlRight':62,'F17':64,'NumpadDecimal':65,
 'NumpadMultiply':67,'NumpadAdd':69,'NumLock':71,'NumpadDivide':75,'NumpadEnter':76,'NumpadSubtract':78,
 'F18':79,'F19':80,'NumpadEqual':81,'Numpad0':82,'Numpad1':83,'Numpad2':84,'Numpad3':85,'Numpad4':86,
 'Numpad5':87,'Numpad6':88,'Numpad7':89,'F20':90,'Numpad8':91,'Numpad9':92,'F5':96,'F6':97,'F7':98,
 'F3':99,'F8':100,'F9':101,'F11':103,'F13':105,'F16':106,'F14':107,'F10':109,'F12':111,'F15':113,
 'Home':115,'PageUp':116,'Delete':117,'F4':118,'End':119,'F2':120,'PageDown':121,'F1':122,
 'ArrowLeft':123,'ArrowRight':124,'ArrowDown':125,'ArrowUp':126,
}
def number(x): return isinstance(x,(int,float)) and not isinstance(x,bool) and math.isfinite(x)
def valid(e):
 if not isinstance(e,dict): return False
 t=e.get('type')
 if t in ('ping','release'): return True
 if t=='text': return isinstance(e.get('text'),str) and len(e['text'])<=2000
 if t=='key': return e.get('code') in KEYS and isinstance(e.get('down'),bool)
 if t=='pointer': return e.get('action') in ('move','down','up') and all(number(e.get(k)) and 0<=e[k]<=1 for k in ('x','y')) and e.get('button',0) in (0,1,2)
 if t=='wheel': return all(number(e.get(k)) and abs(e[k])<=2000 for k in ('dx','dy'))
 return False
