// Applies every Prisma migration to an in-process PostgreSQL (PGlite, WASM) and runs
// sanity checks on the hand-written constraints. No local PostgreSQL server needed.
//   npm run test:migrations
import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'prisma', 'migrations');
const db = new PGlite();
let failures = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.error(`  ✗ ${name}: ${e.message}`);
  }
};
const expectError = async (sql, params, pattern) => {
  try {
    await db.query(sql, params);
  } catch (e) {
    if (pattern.test(e.message)) return;
    throw new Error(`unexpected error: ${e.message}`);
  }
  throw new Error('statement should have failed');
};

for (const m of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
  await db.exec(readFileSync(join(dir, m, 'migration.sql'), 'utf8'));
  console.log(`applied ${m}`);
}

const admin = '00000000-0000-4000-8000-000000000001';
const worker = '00000000-0000-4000-8000-000000000002';
const pin = (c) => c.repeat(64);

await check('users insert + global PIN uniqueness', async () => {
  await db.query(`INSERT INTO users (id, role, name, pin_hash, updated_at) VALUES ($1,'SYSTEM_ADMIN','a',$2, now())`, [admin, pin('a')]);
  await db.query(`INSERT INTO users (id, role, name, pin_hash, updated_at) VALUES ($1,'WORKER','w',$2, now())`, [worker, pin('b')]);
  await expectError(
    `INSERT INTO users (id, role, name, pin_hash, updated_at) VALUES (gen_random_uuid(),'MANAGER','m',$1, now())`,
    [pin('a')],
    /unique/i,
  );
});
await check('raw PIN cannot be stored', () =>
  expectError(`UPDATE users SET pin_hash = '1234' WHERE id = $1`, [worker], /users_pin_hash_format/),
);
await check('request idempotency key unique per manager', async () => {
  await db.query(
    `INSERT INTO requests (id, title, created_by_id, target_type, idempotency_key, updated_at) VALUES (gen_random_uuid(),'t',$1,'SINGLE','k1', now())`,
    [admin],
  );
  await expectError(
    `INSERT INTO requests (id, title, created_by_id, target_type, idempotency_key, updated_at) VALUES (gen_random_uuid(),'t2',$1,'SINGLE','k1', now())`,
    [admin],
    /unique/i,
  );
});
await check('blank title rejected', () =>
  expectError(
    `INSERT INTO requests (id, title, created_by_id, target_type, idempotency_key, updated_at) VALUES (gen_random_uuid(),'   ',$1,'SINGLE','k2', now())`,
    [admin],
    /requests_title_not_blank/,
  ),
);
await check('attachment position limited to 0..2', () =>
  expectError(
    `INSERT INTO request_attachments (id, uploaded_by_id, client_upload_id, position, mime_type, width, height, size_bytes, sha256, data, thumbnail)
     VALUES (gen_random_uuid(), $1, 'u1', 3, 'image/webp', 1, 1, 1, 'x', '\\x00', '\\x00')`,
    [admin],
    /request_attachments_position_range/,
  ),
);
await check('audit_logs are append-only', async () => {
  await db.query(`INSERT INTO audit_logs (id, action, entity_type) VALUES (gen_random_uuid(), 'X', 'test')`);
  await expectError(`DELETE FROM audit_logs`, [], /append-only/);
  await expectError(`UPDATE audit_logs SET action = 'Y'`, [], /append-only/);
});
await check('login_logs are append-only', async () => {
  await db.query(`INSERT INTO login_logs (id, user_id, role) VALUES (gen_random_uuid(), $1, 'WORKER')`, [worker]);
  await expectError(`DELETE FROM login_logs`, [], /append-only/);
});
await check('timestamps are timestamptz with millisecond precision', async () => {
  const { rows } = await db.query(
    `SELECT data_type, datetime_precision FROM information_schema.columns WHERE table_name='request_recipients' AND column_name='acknowledged_at'`,
  );
  if (rows[0].data_type !== 'timestamp with time zone' || rows[0].datetime_precision !== 3) throw new Error(JSON.stringify(rows[0]));
});

await db.close();
if (failures) {
  console.error(`\n${failures} migration check(s) failed`);
  process.exit(1);
}
console.log('\nAll migration checks passed');
