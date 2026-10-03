/**
 * ⚠️ DEVELOPMENT SEED ONLY — fake accounts with well-known PINs.
 * Refuses to run when NODE_ENV=production (unless ALLOW_DEV_SEED=true, e.g. a staging DB).
 *
 *   npm run seed:dev
 */
import { PrismaClient, Role } from '@prisma/client';
import { createHmac } from 'crypto';

if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_SEED !== 'true') {
  console.error('Refusing to run the development seed in production.');
  process.exit(1);
}
const secret = process.env.AUTH_SECRET;
if (!secret || secret.length < 32) {
  console.error('AUTH_SECRET (≥32 chars) is required — it must match the backend so PINs work.');
  process.exit(1);
}
const pinHash = (pin: string) => createHmac('sha256', secret).update(`pin:${pin}`).digest('hex');

const ACCOUNTS: Array<{ name: string; role: Role; pin: string; phone?: string }> = [
  { name: 'مدير النظام (تجريبي)', role: Role.SYSTEM_ADMIN, pin: '1000' },
  { name: 'المدير محمد (تجريبي)', role: Role.MANAGER, pin: '2000' },
  { name: 'أحمد (عامل تجريبي)', role: Role.WORKER, pin: '3001', phone: '0500000001' },
  { name: 'محمود (عامل تجريبي)', role: Role.WORKER, pin: '3002', phone: '0500000002' },
];

async function main() {
  const prisma = new PrismaClient();
  try {
    for (const a of ACCOUNTS) {
      const hash = pinHash(a.pin);
      const existing = await prisma.user.findUnique({ where: { pinHash: hash } });
      if (existing) {
        console.log(`• exists: ${a.name}`);
        continue;
      }
      await prisma.user.create({
        data: {
          name: a.name,
          role: a.role,
          pinHash: hash,
          ...(a.role === Role.WORKER ? { worker: { create: { phone: a.phone ?? '' } } } : {}),
        },
      });
      console.log(`• created: ${a.name}  (PIN ${a.pin})`);
    }
    console.log('\nDevelopment seed complete. These PINs are public — never use them in production.');
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
