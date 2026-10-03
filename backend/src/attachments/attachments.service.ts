import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma, Role } from '@prisma/client';
import { AuthUser } from '../common/auth/auth-user';
import { AppException } from '../common/errors/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ImageProcessorService } from './image-processor.service';

export const MAX_IMAGES_PER_REQUEST = 3;
const ORPHAN_TTL_MS = 24 * 3600 * 1000;

export const attachmentMetaSelect = {
  id: true,
  position: true,
  mimeType: true,
  width: true,
  height: true,
  sizeBytes: true,
} satisfies Prisma.RequestAttachmentSelect;

/**
 * Two-phase upload: images are uploaded first (each with a client-generated id, so a
 * retry after a network drop never duplicates), then the request references them.
 * An interrupted send therefore never loses the request — the client simply retries.
 */
@Injectable()
export class AttachmentsService {
  private readonly logger = new Logger(AttachmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly images: ImageProcessorService,
    private readonly settings: SettingsService,
  ) {}

  async upload(file: Buffer, clientUploadId: string, user: AuthUser) {
    const existing = await this.prisma.requestAttachment.findUnique({
      where: { uploadedById_clientUploadId: { uploadedById: user.id, clientUploadId } },
      select: { ...attachmentMetaSelect, requestId: true },
    });
    if (existing) return existing;

    const [maxDimension, quality] = await Promise.all([
      this.settings.get('images.maxDimension'),
      this.settings.get('images.quality'),
    ]);
    const img = await this.images.process(file, { maxDimension, quality });
    try {
      return await this.prisma.requestAttachment.create({
        data: {
          uploadedById: user.id,
          clientUploadId,
          mimeType: img.mimeType,
          width: img.width,
          height: img.height,
          sizeBytes: img.data.length,
          sha256: img.sha256,
          data: img.data,
          thumbnail: img.thumbnail,
        },
        select: { ...attachmentMetaSelect, requestId: true },
      });
    } catch (e) {
      // Two concurrent retries of the same upload: return the winner.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return this.prisma.requestAttachment.findUniqueOrThrow({
          where: { uploadedById_clientUploadId: { uploadedById: user.id, clientUploadId } },
          select: { ...attachmentMetaSelect, requestId: true },
        });
      }
      throw e;
    }
  }

  /**
   * Returns image bytes after authorization:
   * system admin → all; manager → own uploads/requests; worker → requests addressed to them.
   */
  async read(id: string, variant: 'full' | 'thumb', user: AuthUser) {
    const att = await this.prisma.requestAttachment.findUnique({
      where: { id },
      select: {
        uploadedById: true,
        mimeType: true,
        sha256: true,
        data: variant === 'full',
        thumbnail: variant === 'thumb',
        request: { select: { createdById: true, recipients: { where: { workerId: user.id }, select: { id: true } } } },
      },
    });
    if (!att) throw new AppException('NOT_FOUND');

    const allowed =
      user.role === Role.SYSTEM_ADMIN ||
      att.uploadedById === user.id ||
      att.request?.createdById === user.id ||
      (user.role === Role.WORKER && (att.request?.recipients.length ?? 0) > 0);
    if (!allowed) throw new AppException('NOT_FOUND'); // do not reveal existence

    const bytes = variant === 'full' ? att.data : att.thumbnail;
    return { data: Buffer.from(bytes as Uint8Array), mime: att.mimeType, etag: `${att.sha256.slice(0, 24)}-${variant}` };
  }

  /** Validates that attachments can be linked to a new/edited request by this user. */
  async assertLinkable(
    tx: Prisma.TransactionClient,
    ids: string[],
    userId: string,
    allowRequestId?: string,
  ): Promise<void> {
    if (ids.length > MAX_IMAGES_PER_REQUEST) throw new AppException('TOO_MANY_IMAGES');
    if (new Set(ids).size !== ids.length) throw new AppException('ATTACHMENT_NOT_AVAILABLE');
    if (ids.length === 0) return;
    const rows = await tx.requestAttachment.findMany({
      where: { id: { in: ids }, uploadedById: userId },
      select: { id: true, requestId: true },
    });
    const ok =
      rows.length === ids.length && rows.every((r) => r.requestId === null || (allowRequestId !== undefined && r.requestId === allowRequestId));
    if (!ok) throw new AppException('ATTACHMENT_NOT_AVAILABLE');
  }

  async link(tx: Prisma.TransactionClient, requestId: string, ids: string[]): Promise<void> {
    for (const [position, id] of ids.entries()) {
      await tx.requestAttachment.update({ where: { id }, data: { requestId, position } });
    }
  }

  /** Copies images of a previous request into a new one (resend). */
  async copyToRequest(tx: Prisma.TransactionClient, fromRequestId: string, toRequestId: string, userId: string): Promise<void> {
    const source = await tx.requestAttachment.findMany({ where: { requestId: fromRequestId }, orderBy: { position: 'asc' } });
    for (const a of source) {
      await tx.requestAttachment.create({
        data: {
          requestId: toRequestId,
          uploadedById: userId,
          clientUploadId: `copy:${toRequestId}:${a.id}`.slice(0, 64),
          position: a.position,
          mimeType: a.mimeType,
          width: a.width,
          height: a.height,
          sizeBytes: a.sizeBytes,
          sha256: a.sha256,
          data: a.data,
          thumbnail: a.thumbnail,
        },
      });
    }
  }

  /** Uploads never attached to a request (abandoned drafts) are purged after 24h. */
  @Interval('attachments-cleanup', 3_600_000)
  async purgeOrphans(): Promise<number> {
    const { count } = await this.prisma.requestAttachment.deleteMany({
      where: { requestId: null, createdAt: { lt: new Date(Date.now() - ORPHAN_TTL_MS) } },
    });
    if (count) this.logger.log(`Purged ${count} orphan uploads`);
    return count;
  }
}
