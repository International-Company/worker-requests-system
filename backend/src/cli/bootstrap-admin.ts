/**
 * Creates the FIRST system admin of a fresh production database.
 * Does nothing if an active system admin already exists.
 *
 *   BOOTSTRAP_ADMIN_NAME="..." BOOTSTRAP_ADMIN_PIN=4821 npm run bootstrap:admin
 *
 * Remove BOOTSTRAP_ADMIN_PIN from the environment afterwards.
 */
import { PrismaClient, Role } from '@prisma/client';
import { createHmac } from 'crypto';

async function main() {
  const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'مدير النظام';
  const pin = process.env.BOOTSTRAP_ADMIN_PIN?.trim() ?? '';
  const secret = process.env.AUTH_SECRET ?? '';
  if (!/^\d{4}$/.test(pin)) throw new Error('BOOTSTRAP_ADMIN_PIN must be exactly 4 digits');
  if (secret.length < 32) throw new Error('AUTH_SECRET (≥32 chars) is required');

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.user.count({ where: { role: Role.SYSTEM_ADMIN, isActive: true, deletedAt: null } });
    if (existing > 0) {
      console.log('An active system admin already exists — nothing to do.');
      return;
    }
    const pinHash = createHmac('sha256', secret).update(`pin:${pin}`).digest('hex');
    if (await prisma.user.findUnique({ where: { pinHash } })) throw new Error('This PIN is already used by another account');
    await prisma.user.create({ data: { name, role: Role.SYSTEM_ADMIN, pinHash } });
    console.log(`System admin "${name}" created. Remove BOOTSTRAP_ADMIN_PIN from the environment now.`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
