import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { AuditAction } from '../audit/audit-actions';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { SETTINGS, SettingDefinition, SettingKey, SettingValue, validateSettingValue } from './settings.definitions';

const CACHE_TTL_MS = 15_000;

@Injectable()
export class SettingsService {
  private cache: { values: Map<string, unknown>; loadedAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    const values = await this.load();
    const stored = values.get(key);
    const def = SETTINGS[key] as SettingDefinition;
    return (validateSettingValue(key, stored) ? stored : def.default) as SettingValue<K>;
  }

  async getAll(): Promise<Array<SettingDefinition & { key: string; value: unknown }>> {
    const values = await this.load();
    return (Object.entries(SETTINGS) as Array<[string, SettingDefinition]>).map(([key, def]) => {
      const stored = values.get(key);
      return { key, ...def, value: validateSettingValue(key, stored) ? stored : def.default };
    });
  }

  async update(
    changes: Record<string, unknown>,
    actor: { id: string; role: Role },
    ip: string | null,
  ): Promise<Array<SettingDefinition & { key: string; value: unknown }>> {
    const entries = Object.entries(changes);
    for (const [key, value] of entries) {
      if (!validateSettingValue(key, value)) throw new AppException('INVALID_SETTING', { key });
    }
    await this.prisma.$transaction(async (tx) => {
      for (const [key, value] of entries) {
        const json = (typeof value === 'string' ? value.trim() : value) as Prisma.InputJsonValue;
        await tx.setting.upsert({
          where: { key },
          create: { key, value: json, updatedById: actor.id },
          update: { value: json, updatedById: actor.id },
        });
      }
      await this.audit.record(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action: AuditAction.SETTINGS_UPDATED,
          entityType: 'settings',
          metadata: changes as Prisma.InputJsonValue,
          ip,
        },
        tx,
      );
    });
    this.cache = null;
    return this.getAll();
  }

  private async load(): Promise<Map<string, unknown>> {
    if (this.cache && Date.now() - this.cache.loadedAt < CACHE_TTL_MS) return this.cache.values;
    const rows = await this.prisma.setting.findMany();
    const values = new Map<string, unknown>(rows.map((r) => [r.key, r.value]));
    this.cache = { values, loadedAt: Date.now() };
    return values;
  }
}
