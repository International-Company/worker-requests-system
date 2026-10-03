// Starts an in-memory PostgreSQL (PGlite) with all migrations applied and exposes it
// over the Postgres wire protocol. Spawned by the e2e harness (one per test file).
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', '..', 'prisma', 'migrations');
const db = await PGlite.create();
for (const m of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
  await db.exec(readFileSync(join(dir, m, 'migration.sql'), 'utf8'));
}

let server;
for (let attempt = 0; attempt < 10; attempt++) {
  const port = 40000 + Math.floor(Math.random() * 20000);
  try {
    server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
    await server.start();
    process.stdout.write(`READY ${port}\n`);
    break;
  } catch {
    server = undefined;
  }
}
if (!server) {
  console.error('could not bind a port');
  process.exit(1);
}

const shutdown = async () => {
  await server.stop().catch(() => {});
  await db.close().catch(() => {});
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.stdin.on('end', shutdown); // parent died
process.stdin.resume();
