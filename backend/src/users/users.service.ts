import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../common/errors/app.exception';
import { PinService } from '../common/security/pin.service';
import { PrismaService } from '../prisma/prisma.service';

/** Shared account helpers used by both the workers and managers modules. */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pins: PinService,
  ) {}

  /** Hashes a PIN and guarantees it is unique across ALL users (single login screen). */
  async assertPinAvailable(pin: string, excludeUserId?: string, tx: Prisma.TransactionClient = this.prisma): Promise<string> {
    const pinHash = this.pins.hash(pin);
    const clash = await tx.user.findFirst({
      where: { pinHash, ...(excludeUserId ? { NOT: { id: excludeUserId } } : {}) },
      select: { id: true },
    });
    if (clash) throw new AppException('PIN_TAKEN');
    return pinHash;
  }

  /** Maps the unique-constraint race (two admins saving the same PIN at once) to PIN_TAKEN. */
  static rethrowPinConflict(e: unknown): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && String(e.meta?.target ?? '').includes('pin')) {
      throw new AppException('PIN_TAKEN');
    }
    throw e;
  }
}
