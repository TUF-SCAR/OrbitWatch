import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '../.setup-cache/pg-test/node_modules/@electric-sql/pglite/dist/index.js';

const tables = ['users', 'satellite_orbit_data', 'satellite_orbit_history'];
const browserRoles = ['anon', 'authenticated', 'unrelated_role'];
const migration = await readFile(new URL('../backend/migrations/010_private_backend_tables.sql', import.meta.url), 'utf8');
const db = new PGlite();

try {
  await db.exec(`
    CREATE ROLE orbitwatch_backend;
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE unrelated_role;
    GRANT CREATE ON SCHEMA public TO orbitwatch_backend;
    SET ROLE orbitwatch_backend;
  `);
  for (const table of tables) {
    await db.exec(`
      CREATE TABLE public.${table} (id integer PRIMARY KEY);
      INSERT INTO public.${table} VALUES (1);
      GRANT ALL ON public.${table} TO PUBLIC, anon, authenticated;
    `);
  }

  await db.exec(migration);
  await db.exec(migration);
  for (const table of tables) {
    const { rows: [policy] } = await db.query(
      'SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = $1::regclass',
      [`public.${table}`],
    );
    assert.deepEqual(policy, { relrowsecurity: true, relforcerowsecurity: false });
    for (const role of browserRoles) {
      const { rows: [grants] } = await db.query(
        "SELECT has_table_privilege($1, $2, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS allowed",
        [role, `public.${table}`],
      );
      assert.equal(grants.allowed, false, `${role} has direct grants on ${table}`);
    }
    const { rows: [row] } = await db.query(`SELECT count(*)::integer AS count FROM public.${table}`);
    assert.equal(row.count, 1);
    await db.exec(`INSERT INTO public.${table} VALUES (2)`);
  }
  console.log('PASS: PostgreSQL backend table isolation, owner access, row preservation and repeated migration');
} finally {
  await db.close();
}
