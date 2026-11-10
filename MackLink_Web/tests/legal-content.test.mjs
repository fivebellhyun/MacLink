import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LEGAL_DATES,legalDocuments} from '../lib/legal-content.ts';

test('each policy carries its own valid effective and updated dates',()=>{
 assert.deepEqual(Object.keys(LEGAL_DATES).sort(),Object.keys(legalDocuments).sort());
 for(const [kind,dates] of Object.entries(LEGAL_DATES)){
  for(const value of [dates.effective,dates.updated]){
   assert.match(value,/^\d{4}-\d{2}-\d{2}$/,kind);
   assert.equal(new Date(value+'T00:00:00Z').toISOString().slice(0,10),value,kind);
  }
  assert.ok(dates.updated>=dates.effective,kind+' cannot be updated before it takes effect');
 }
});
