/**
 * Client-side compression before upload (saves mobile data and makes uploads fast).
 * The server re-validates and re-encodes everything anyway — this is an optimisation,
 * not a security control.
 */
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_IMAGES = 3;
const MAX_DIMENSION = 1600;
const MAX_INPUT_BYTES = 25 * 1024 * 1024;

export class ImageRejected extends Error {}

export async function compressImage(file: File): Promise<{ blob: Blob; name: string }> {
  if (!ACCEPTED_TYPES.includes(file.type) || file.size > MAX_INPUT_BYTES) throw new ImageRejected(file.name);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new ImageRejected(file.name);
  }
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return { blob: file, name: file.name };
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  // Keep the original if the browser cannot encode or the result is not smaller.
  if (!blob || blob.size >= file.size) return { blob: file, name: file.name };
  return { blob, name: file.name.replace(/\.[^.]+$/, '') + '.jpg' };
}
