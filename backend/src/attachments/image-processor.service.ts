import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { AppException } from '../common/errors/app.exception';
import { sha256Hex } from '../common/security/crypto.util';

export const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);
const MAX_INPUT_PIXELS = 60_000_000; // ~60 MP: protects against decompression bombs
const THUMB_DIMENSION = 480;

export interface ProcessedImage {
  data: Uint8Array<ArrayBuffer>;
  thumbnail: Uint8Array<ArrayBuffer>;
  mimeType: 'image/webp';
  width: number;
  height: number;
  sha256: string;
}

/**
 * Validates the REAL content (magic bytes via libvips, not the client-declared MIME),
 * auto-rotates using EXIF, strips all metadata (GPS etc.), resizes and re-encodes to WebP.
 */
@Injectable()
export class ImageProcessorService {
  async process(input: Buffer, opts: { maxDimension: number; quality: number }): Promise<ProcessedImage> {
    let meta: sharp.Metadata;
    try {
      meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    } catch {
      throw new AppException('INVALID_IMAGE');
    }
    if (!meta.format || !ALLOWED_FORMATS.has(meta.format) || !meta.width || !meta.height) {
      throw new AppException('INVALID_IMAGE');
    }

    try {
      const base = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, animated: false }).rotate();
      const { data, info } = await base
        .clone()
        .resize({ width: opts.maxDimension, height: opts.maxDimension, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: opts.quality, effort: 4 })
        .toBuffer({ resolveWithObject: true });
      const thumbnail = await base
        .clone()
        .resize({ width: THUMB_DIMENSION, height: THUMB_DIMENSION, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 70 })
        .toBuffer();
      return {
        data: Uint8Array.from(data),
        thumbnail: Uint8Array.from(thumbnail),
        mimeType: 'image/webp',
        width: info.width,
        height: info.height,
        sha256: sha256Hex(data),
      };
    } catch {
      throw new AppException('INVALID_IMAGE');
    }
  }
}
