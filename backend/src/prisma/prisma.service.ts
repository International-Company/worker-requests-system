import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    // Generous limits so bursts (e.g. a request to every worker) queue instead of failing.
    super({ transactionOptions: { maxWait: 10_000, timeout: 20_000 } });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to PostgreSQL');
  }

  /**
   * Runs after every `beforeApplicationShutdown` hook (e.g. draining in-flight push
   * dispatches), so background work can still write its final status.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
