import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AttachmentsModule } from './attachments/attachments.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { RolesGuard } from './common/auth/roles.guard';
import { SessionAuthGuard } from './common/auth/session-auth.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AppConfigModule } from './config/config.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DevicesModule } from './devices/devices.module';
import { EventsModule } from './events/events.module';
import { HealthController } from './health/health.controller';
import { ManagersModule } from './managers/managers.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PresenceModule } from './presence/presence.module';
import { PrismaModule } from './prisma/prisma.module';
import { PushModule } from './push/push.module';
import { RequestRecipientsModule } from './request-recipients/request-recipients.module';
import { RequestsModule } from './requests/requests.module';
import { RolesModule } from './roles/roles.module';
import { SettingsModule } from './settings/settings.module';
import { UsersModule } from './users/users.module';
import { WorkersModule } from './workers/workers.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    ScheduleModule.forRoot(),
    // Global rate limit per client IP; login routes override with much stricter limits.
    ThrottlerModule.forRoot({
      throttlers: [
        { name: 'default', ttl: 60_000, limit: 300 },
        { name: 'hourly', ttl: 3_600_000, limit: 10_000 },
      ],
      // Only the automated test-suite may switch this off.
      skipIf: () => process.env.NODE_ENV === 'test' && process.env.THROTTLE_DISABLED === 'true',
    }),
    AuditModule,
    SettingsModule,
    EventsModule,
    PushModule,
    UsersModule,
    DevicesModule,
    AuthModule,
    PresenceModule,
    NotificationsModule,
    RolesModule,
    WorkersModule,
    ManagersModule,
    AttachmentsModule,
    RequestsModule,
    RequestRecipientsModule,
    DashboardModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Order matters: rate limit → CSRF + session → role check.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
