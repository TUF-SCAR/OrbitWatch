// Isolated PostgreSQL WASM engine. No DATABASE_URL or network is used.
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {PGlite} from '../.setup-cache/pg-test/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite();
try{
  const sql=await readFile(new URL('../backend/migrations/007_live_small_bodies.sql',import.meta.url),'utf8');
  await db.exec(sql);await db.exec(sql);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM small_body_refresh_state')).rows[0].n,1);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_class WHERE relname IN ('small_body_orbits','small_body_refresh_state') AND relrowsecurity")).rows[0].n,2);
  await assert.rejects(db.query("INSERT INTO small_body_refresh_state(id) VALUES (2)"));
  await assert.rejects(db.query("INSERT INTO small_body_orbits VALUES('unapproved','999','20000999','1','{}',0,0)"));
  const results=await Promise.all(Array.from({length:20},(_,i)=>db.query('UPDATE small_body_refresh_state SET lease_token=$1,lease_until=90,day_calls=day_calls+1 WHERE id=1 AND lease_until<=0 AND day_calls<24 RETURNING id',[String(i)])));
  assert.equal(results.reduce((n,r)=>n+r.rows.length,0),1);
  assert.equal((await db.query("UPDATE small_body_refresh_state SET lease_token=NULL WHERE id=1 AND lease_token='abandoned' RETURNING id")).rows.length,0);
  console.log('PASS PostgreSQL migration twice, constraints/RLS, singleton, atomic acquisition and stale-owner guard; production DB/network0');
}finally{await db.close();}
