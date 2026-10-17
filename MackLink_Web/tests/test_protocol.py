import sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'connector'))
from protocol import valid,KEYS
from maclink import MacInput
class Protocol(unittest.TestCase):
 def test_invalid_input(self):
  for e in [None,{'type':'shell','command':'x'},{'type':'pointer','action':'down','x':1.01,'y':0},{'type':'key','code':'BadKey','down':True},{'type':'wheel','dx':float('nan'),'dy':0},{'type':'text','text':'a'*2001}]:self.assertFalse(valid(e))
 def test_expected_inputs(self):
  for e in [{'type':'ping'},{'type':'release'},{'type':'text','text':'한글 입력 😀'},{'type':'pointer','action':'up','x':1,'y':0,'button':2},{'type':'key','code':'MetaLeft','down':True},{'type':'wheel','dx':-2,'dy':2}]:self.assertTrue(valid(e))
 def test_permissions_and_sequence(self):
  class Quartz:
   pass # Accessibility entry points are not part of Quartz.
  class ApplicationServices:
   @staticmethod
   def AXIsProcessTrusted():return True
  m=MacInput(Quartz,ApplicationServices);sent=[];m.key=lambda code,down:sent.append((code,down))
  e={'type':'key','code':'KeyA','down':True,'seq':1};m.accept(e,False);self.assertEqual(sent,[])
  m.accept(e,True);m.accept(e,True);self.assertEqual(sent,[('KeyA',True)])
  ApplicationServices.AXIsProcessTrusted=lambda:False;m.accept(dict(e,seq=2),True);self.assertEqual(len(sent),1)
if __name__=='__main__':unittest.main()
