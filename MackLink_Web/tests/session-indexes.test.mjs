import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';

// D1 bills every row a query reads. A device keeps every past connection in `sessions`, so the
// heartbeat (every 4s) and device list must read only live sessions and the newest history rows.
function migrated(){
 const db=new DatabaseSync(':memory:');
 for(const f of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));
 return db;
}
const plan=(db,sql)=>db.prepare('EXPLAIN QUERY PLAN '+sql).all().map(row=>row.detail).join(' | ');

test('live-session queries use the partial index that leaves ended sessions out',()=>{
 const db=migrated();
 for(const sql of [
  "SELECT * FROM sessions WHERE device=? AND status!='ended' AND status IN ('approved','active') AND seen<?",
  "SELECT * FROM sessions WHERE device=? AND status!='ended' AND status IN ('approved','active') ORDER BY created DESC LIMIT 1",
  "SELECT * FROM sessions WHERE device=? AND id!=? AND status!='ended' AND status='reconnecting'",
  "UPDATE sessions SET status='ended' WHERE device=? AND status!='ended'",
  "SELECT 1 FROM sessions AS other WHERE other.device=? AND other.id!=? AND other.status!='ended' AND other.seen>?",
 ])assert.match(plan(db,sql),/USING INDEX sessions_device_live \(device=\?\)/,sql);
});

test('connection history reads the newest rows in index order without sorting every session',()=>{
 const query=plan(migrated(),'SELECT id,guest_name,mode,status,created,reason FROM sessions WHERE device=? ORDER BY created DESC LIMIT 6');
 assert.match(query,/USING INDEX sessions_device_created \(device=\?\)/);
 assert.doesNotMatch(query,/TEMP B-TREE/);
});

test('the partial index holds only live sessions',()=>{
 const db=migrated(),now=Date.now();
 const insert=db.prepare("INSERT INTO sessions (id,device,guest_hash,guest_name,mode,status,offer,created,expires,seen) VALUES (?,?,?,?,?,?,?,?,?,?)");
 for(let i=0;i<200;i++)insert.run('old'+i,'mac','h','Device owner','control','ended','',now-i,0,now-i);
 insert.run('live','mac','h','Device owner','control','active','v=0',now,0,now);
 const counted=db.prepare("SELECT COUNT(*) AS n FROM sessions INDEXED BY sessions_device_live WHERE device=? AND status!='ended'").get('mac');
 assert.equal(counted.n,1);
});

test('hot server queries keep the live-session filter that lets SQLite pick the partial index',()=>{
 const source=readFileSync(new URL('../lib/server.ts',import.meta.url),'utf8');
 for(const fragment of [
  "FROM sessions WHERE device=? AND status!='ended' AND status IN ('approved','active') AND seen<?",
  "FROM sessions WHERE device=? AND status!='ended' AND status IN ('approved','active') ORDER BY created DESC LIMIT 1",
  "FROM sessions WHERE device=? AND id!=? AND status!='ended' AND status='reconnecting'",
 ])assert.ok(source.includes(fragment),fragment);
});
