import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { fmt, t } from '../i18n';
import { attachmentUrl } from '../lib/api';
import { cx } from './ui';

interface Img {
  id: string;
  width: number;
  height: number;
}

/**
 * Large, clear request images. One image → full width; 2–3 → big first image + thumbnails.
 * Tap any image to open a full-screen viewer (swipe/arrow navigation).
 */
export function Gallery({ images, compact }: { images: Img[]; compact?: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  if (images.length === 0) return null;
  const [first, ...rest] = images;
  return (
    <>
      <div className="space-y-2">
        <button type="button" onClick={() => setOpen(0)} className="block w-full overflow-hidden rounded-lg bg-surface" aria-label={t.worker.openImage}>
          <img
            src={attachmentUrl(first.id, compact ? 'thumb' : 'full')}
            alt=""
            width={first.width}
            height={first.height}
            loading="lazy"
            className={cx('w-full object-contain', compact ? 'max-h-56' : 'max-h-[60vh]')}
          />
        </button>
        {rest.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {rest.map((img, i) => (
              <button
                key={img.id}
                type="button"
                onClick={() => setOpen(i + 1)}
                className="overflow-hidden rounded-lg bg-surface"
                aria-label={t.worker.openImage}
              >
                <img src={attachmentUrl(img.id, 'thumb')} alt="" loading="lazy" className="aspect-[4/3] w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
      {open !== null && <Lightbox images={images} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </>
  );
}

export function ImageCount({ n }: { n: number }) {
  return <span className="text-xs text-muted">{fmt(t.worker.imagesCount, { n })}</span>;
}

function Lightbox({ images, index, onIndex, onClose }: { images: Img[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const go = useCallback((d: number) => onIndex((index + d + images.length) % images.length), [index, images.length, onIndex]);
  const [touchX, setTouchX] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') go(1); // RTL: left = next
      if (e.key === 'ArrowRight') go(-1);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [go, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/95"
      role="dialog"
      aria-modal="true"
      onTouchStart={(e) => setTouchX(e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX === null) return;
        const dx = e.changedTouches[0].clientX - touchX;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
        setTouchX(null);
      }}
    >
      <div className="safe-top flex items-center justify-between p-2 text-white">
        <span className="ltr-nums px-3 text-sm opacity-80">
          {index + 1} / {images.length}
        </span>
        <button type="button" onClick={onClose} className="flex size-12 items-center justify-center rounded-full hover:bg-white/10" aria-label={t.common.close}>
          <X className="size-7" />
        </button>
      </div>
      <div className="relative flex flex-1 items-center justify-center overflow-hidden p-2">
        <img src={attachmentUrl(images[index].id, 'full')} alt="" className="max-h-full max-w-full object-contain" />
        {images.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              className="absolute right-2 top-1/2 flex size-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white"
              aria-label={t.common.previous}
            >
              <ChevronRight className="size-7" />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              className="absolute left-2 top-1/2 flex size-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white"
              aria-label={t.common.next}
            >
              <ChevronLeft className="size-7" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
