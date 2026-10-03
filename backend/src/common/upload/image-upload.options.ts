import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { memoryStorage } from 'multer';
import { ALLOWED_IMAGE_MIME } from '../../attachments/image-processor.service';
import { AppException } from '../errors/app.exception';

/**
 * First line of defence for uploads: single file, size cap, image MIME only.
 * The content itself is re-validated by ImageProcessorService (magic bytes).
 */
export function imageUploadOptions(maxBytes: number): MulterOptions {
  return {
    storage: memoryStorage(),
    limits: { fileSize: maxBytes, files: 1, fields: 10 },
    fileFilter: (_req, file, cb) => {
      if (!(ALLOWED_IMAGE_MIME as readonly string[]).includes(file.mimetype)) {
        cb(new AppException('INVALID_IMAGE'), false);
        return;
      }
      cb(null, true);
    },
  };
}

export const DEFAULT_MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB ?? 10) * 1024 * 1024;
