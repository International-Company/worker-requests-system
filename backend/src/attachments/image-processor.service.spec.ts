import sharp from 'sharp';
import { AppException } from '../common/errors/app.exception';
import { ImageProcessorService } from './image-processor.service';

describe('ImageProcessorService', () => {
  const svc = new ImageProcessorService();
  const opts = { maxDimension: 1600, quality: 80 };

  const make = (w: number, h: number, fmt: 'jpeg' | 'png' | 'webp' | 'gif' | 'tiff') =>
    sharp({ create: { width: w, height: h, channels: 3, background: '#2563eb' } })[fmt]().toBuffer();

  it.each(['jpeg', 'png', 'webp'] as const)('accepts %s and re-encodes to WebP within the max dimension', async (fmt) => {
    const out = await svc.process(await make(3000, 2000, fmt), opts);
    expect(out.mimeType).toBe('image/webp');
    expect(out.width).toBe(1600);
    expect(out.height).toBe(1067);
    const meta = await sharp(Buffer.from(out.data)).metadata();
    expect(meta.format).toBe('webp');
    const thumb = await sharp(Buffer.from(out.thumbnail)).metadata();
    expect(Math.max(thumb.width!, thumb.height!)).toBeLessThanOrEqual(480);
    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never upscales small images', async () => {
    const out = await svc.process(await make(300, 200, 'png'), opts);
    expect([out.width, out.height]).toEqual([300, 200]);
  });

  it('strips metadata (e.g. GPS EXIF)', async () => {
    const withExif = await sharp(await make(800, 600, 'jpeg'))
      .withExif({ IFD0: { Copyright: 'secret-location' } })
      .jpeg()
      .toBuffer();
    const out = await svc.process(withExif, opts);
    expect((await sharp(Buffer.from(out.data)).metadata()).exif).toBeUndefined();
  });

  it.each([
    ['PDF', Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj<<>>endobj')],
    ['Word/zip', Buffer.from('PK\u0003\u0004 fake docx')],
    ['plain text', Buffer.from('hello')],
    ['HTML', Buffer.from('<script>alert(1)</script>')],
  ])('rejects %s', async (_name, buf) => {
    await expect(svc.process(buf, opts)).rejects.toBeInstanceOf(AppException);
  });

  it('rejects image formats outside the allow-list (GIF, TIFF)', async () => {
    await expect(svc.process(await make(50, 50, 'gif'), opts)).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
    await expect(svc.process(await make(50, 50, 'tiff'), opts)).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
  });
});
