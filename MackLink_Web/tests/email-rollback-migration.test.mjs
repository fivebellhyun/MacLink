import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';

test('restoring email invitations preserves a populated account-only database and accepts guest sessions',t=>{
 const sqlite=new DatabaseSync(':memory:');
 t.after(()=>sqlite.close());
 sqlite.exec('PRAGMA foreign_keys=ON');
 const migrationDirectory=new URL('../drizzle/',import.meta.url);
 const previousMigrations=readdirSync(migrationDirectory).filter(file=>/^000[0-7]_.*\.sql$/.test(file)).sort();
 assert.equal(previousMigrations.length,8);
 assert.equal(previousMigrations.at(-1),'0007_account_devices.sql');
 for(const file of previousMigrations)sqlite.exec(readFileSync(new URL(file,migrationDirectory),'utf8'));

 const columns=table=>sqlite.prepare(`PRAGMA table_info(${table})`).all();
 const rows=table=>sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row=>({...row}));
 assert.equal(columns('sessions').some(column=>column.name==='invite'),false);
 for(const table of ['invites','invite_verifications','owner_identities'])assert.equal(columns(table).length,0);

 const owner='google:migration-test',now=1_800_000_000_000,authHash='a'.repeat(64);
 sqlite.prepare('INSERT INTO auth_users (id,google_sub,email,name,created,updated) VALUES (?,?,?,?,?,?)')
  .run(owner,'migration-test','host@example.com','Synthetic host',now-1000,now);
 sqlite.prepare('INSERT INTO auth_sessions (token_hash,user_id,created,expires) VALUES (?,?,?,?)')
  .run(authHash,owner,now,now+86_400_000);
 sqlite.prepare('INSERT INTO auth_transactions (state_hash,browser_hash,verifier,nonce,return_path,expires) VALUES (?,?,?,?,?,?)')
  .run('synthetic-state','synthetic-browser','synthetic-verifier','synthetic-nonce','/',now+600_000);
 sqlite.prepare('INSERT INTO devices (id,owner,name,agent_hash,created,seen,enabled,info) VALUES (?,?,?,?,?,?,?,?)')
  .run('existing-device',owner,'Synthetic Mac','b'.repeat(64),now-1000,now,1,'{"screen":true,"qualityControl":true}');
 sqlite.prepare('INSERT INTO sessions (id,device,owner,auth_session_hash,guest_hash,guest_name,mode,generation,status,offer,answer,created,expires,seen,reason,quality,quality_applied) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  .run('existing-account-session','existing-device',owner,authHash,'c'.repeat(64),'Synthetic host','control',7,'active','v=0 synthetic offer','v=0 synthetic answer',now-1000,0,now,null,'low','low');
 sqlite.prepare('INSERT INTO turn_settings (owner,sealed,updated) VALUES (?,?,?)')
  .run(owner,'synthetic-sealed-settings',now);
 sqlite.prepare('INSERT INTO turn_credentials (subject,owner,sealed,expires) VALUES (?,?,?,?)')
  .run('synthetic-turn-subject',owner,'synthetic-sealed-credentials',now+60_000);

 const preservedTables=['auth_users','auth_sessions','auth_transactions','devices','sessions','turn_settings','turn_credentials'];
 const before=Object.fromEntries(preservedTables.map(table=>[table,rows(table)]));
 const existingSessionColumns=columns('sessions').map(column=>column.name);
 sqlite.exec(readFileSync(new URL('0008_restore_email_invites.sql',migrationDirectory),'utf8'));

 for(const table of preservedTables){
  const after=rows(table);
  if(table==='sessions')for(const row of after)delete row.invite;
  assert.deepEqual(after,before[table],`${table} values must survive the compatibility migration`);
 }
 const sessionColumns=columns('sessions');
 assert.deepEqual(sessionColumns.map(column=>column.name),[...existingSessionColumns,'invite']);
 assert.deepEqual(sessionColumns.filter(column=>['owner','auth_session_hash','invite'].includes(column.name)).map(column=>column.name).sort(),['auth_session_hash','invite','owner']);
 const inviteColumn=sessionColumns.find(column=>column.name==='invite');
 assert.equal(inviteColumn.notnull,1);
 assert.equal(inviteColumn.dflt_value,"''");
 assert.equal(sqlite.prepare('SELECT invite FROM sessions WHERE id=?').get('existing-account-session').invite,'');
 assert.ok(sqlite.prepare('PRAGMA index_list(sessions)').all().some(index=>index.name==='sessions_auth'));
 assert.ok(sqlite.prepare('PRAGMA index_list(invites)').all().some(index=>index.name==='invites_device'));

 sqlite.prepare('INSERT INTO owner_identities (owner,email_hash,updated) VALUES (?,?,?)').run(owner,'synthetic-email-hash',now);
 sqlite.prepare('INSERT INTO invites (id,device,secret_hash,mode,expires,reusable) VALUES (?,?,?,?,?,?)')
  .run('new-invite','existing-device','d'.repeat(64),'view',0,1);
 sqlite.prepare('INSERT INTO invite_verifications (invite,failures,window) VALUES (?,?,?)').run('new-invite',1,now);
 sqlite.prepare('INSERT INTO sessions (id,device,invite,guest_hash,guest_name,mode,status,offer,created,expires,seen,generation) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
  .run('new-guest-session','existing-device','new-invite','e'.repeat(64),'Remote visitor','view','approved','v=0 synthetic guest offer',now,0,now,0);
 assert.deepEqual({...sqlite.prepare('SELECT invite,owner,auth_session_hash,mode,status FROM sessions WHERE id=?').get('new-guest-session')},
  {invite:'new-invite',owner:null,auth_session_hash:null,mode:'view',status:'approved'});
 assert.equal(sqlite.prepare('SELECT used FROM invites WHERE id=?').get('new-invite').used,0);
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM owner_identities').get().n,1);
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM invite_verifications').get().n,1);
 assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 assert.equal(sqlite.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
});
