import pg from 'pg';
import { readFile } from 'node:fs/promises';
const url = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) throw new Error('DATABASE_URL is required');
const client = new pg.Client({connectionString:url, connectionTimeoutMillis:8000});
await client.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(810203)');
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY)');
  for (const version of ['001_schema','seed']) {
    const applied = await client.query('SELECT 1 FROM schema_migrations WHERE version=$1',[version]);
    if (!applied.rowCount) {
      await client.query(await readFile(new URL('../sql/'+version+'.sql',import.meta.url),'utf8'));
      await client.query('INSERT INTO schema_migrations VALUES($1)',[version]);
    }
  }
  await client.query('COMMIT');
  console.log('Schema and demo data ready');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}