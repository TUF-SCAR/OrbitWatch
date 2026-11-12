// Disposable embedded PostgreSQL, no production connection or seed data.
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {PGlite} from '../.setup-cache/pg-test/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite();
try{
  await db.exec('CREATE TABLE users(id integer PRIMARY KEY);');
  for(const name of ['002_account_notification_foundation.sql','003_account_alert_subscriptions.sql','004_account_notification_inbox.sql','005_notification_delivery.sql','008_viewing_opportunities.sql']){
    const sql=await readFile(new URL(`../backend/migrations/${name}`,import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);
  }
  assert.equal((await db.query("SELECT count(*)::int n FROM pg_class WHERE relname IN('account_viewing_opportunities','visibility_plan_cache') AND relrowsecurity")).rows[0].n,2);
  assert.equal((await db.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_name='account_notification_delivery' AND column_name IN('alert_stage','opportunity_id','details')")).rows[0].n,3);
  assert.equal((await db.query("SELECT count(*)::int n FROM pg_indexes WHERE indexname IN('uq_delivery_opportunity_stage','ix_viewing_visible_due','ix_viewing_owner_end')")).rows[0].n,3);
  await db.exec("INSERT INTO users VALUES(1); INSERT INTO account_observation_locations(id,owner_id,slot,name,latitude,longitude,timezone,is_default,version) VALUES('00000000-0000-0000-0000-000000000001',1,1,'ISOLATED FIXTURE',0,0,'UTC',true,1); INSERT INTO account_alert_subscriptions(id,owner_id,kind,target_id,target_name,slot) VALUES('00000000-0000-0000-0000-000000000002',1,'celestial','moon','Moon',1)");
  const insert="INSERT INTO account_viewing_opportunities(identity,owner_id,location_id,subscription_id,kind,target_id,source_key,location_version,preference_version,warning_minutes,start_at,peak_at,end_at,advance_due_at,visible_due_at,calculated_at,refresh_at,details) VALUES(repeat('a',64),1,'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','celestial','moon',repeat('b',64),1,1,30,now()+interval '30min',now()+interval '40min',now()+interval '50min',now(),now()+interval '30min',now(),now()+interval '10min','{}')";
  await db.exec(insert);await assert.rejects(db.exec(insert));
  await db.exec('CREATE ROLE viewing_fixture NOLOGIN; GRANT USAGE ON SCHEMA public TO viewing_fixture; GRANT SELECT ON account_viewing_opportunities,visibility_plan_cache TO viewing_fixture; SET ROLE viewing_fixture;');
  assert.equal((await db.query('SELECT count(*)::int n FROM account_viewing_opportunities')).rows[0].n,0);
  console.log('PASS additive migrations002–005/008 applied twice; RLS isolation, stage columns, due/unique indexes, opportunity identity constraint; production/network0');
}finally{await db.close();}
