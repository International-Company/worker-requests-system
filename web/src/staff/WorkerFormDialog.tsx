import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ImagePlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useToast } from '../components/Toast';
import { Button, Dialog, Field, Input } from '../components/ui';
import { t } from '../i18n';
import { ApiError, errorMessage, patch, post, put, workerPhotoUrl } from '../lib/api';
import { ACCEPTED_TYPES, compressImage } from '../lib/image-compress';
import type { Worker } from '../lib/types';

/** Add / edit worker: name, photo, phone, PIN (on create), status. */
export function WorkerFormDialog({ open, worker, onClose }: { open: boolean; worker?: Worker; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [photo, setPhoto] = useState<{ blob: Blob; name: string; preview: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(worker?.name ?? '');
    setPhone(worker?.phone ?? '');
    setPin('');
    setIsActive(worker?.isActive ?? true);
    setPhoto(null);
    setError(null);
  }, [open, worker]);

  const save = useMutation({
    mutationFn: async () => {
      const saved = worker
        ? await patch<Worker>(`/workers/${worker.id}`, { name, phone, isActive })
        : await post<Worker>('/workers', { name, phone, pin, isActive });
      if (photo) {
        const form = new FormData();
        form.append('file', photo.blob, photo.name);
        await put(`/workers/${saved.id}/photo`, form);
      }
      return saved;
    },
    onSuccess: () => {
      toast.success(worker ? t.workers.updated : t.workers.created);
      void qc.invalidateQueries({ queryKey: ['workers'] });
      onClose();
    },
    onError: (e) => {
      // Show validation details (Arabic messages from the server) when available.
      const details = e instanceof ApiError && Array.isArray(e.details) ? (e.details as string[]).join('، ') : null;
      setError(details ?? errorMessage(e));
    },
  });

  const valid = name.trim().length >= 2 && /^\+?[0-9 -]{6,20}$/.test(phone.trim()) && (worker || /^\d{4}$/.test(pin));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={worker ? t.workers.edit : t.workers.add}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!valid}>
            {t.common.save}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) save.mutate();
        }}
      >
        <div className="flex items-center gap-4">
          {photo ? (
            <img src={photo.preview} alt="" className="size-16 rounded-full object-cover" />
          ) : worker?.photoVersion ? (
            <img src={workerPhotoUrl(worker.id, worker.photoVersion)} alt="" className="size-16 rounded-full object-cover" />
          ) : (
            <div className="flex size-16 items-center justify-center rounded-full bg-brand-50 text-brand-300">
              <ImagePlus className="size-7" />
            </div>
          )}
          <label className="inline-flex h-10 cursor-pointer items-center rounded-lg border border-line px-3 text-sm font-semibold hover:bg-surface">
            {t.workers.choosePhoto}
            <input
              type="file"
              accept={ACCEPTED_TYPES.join(',')}
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                try {
                  const c = await compressImage(file);
                  setPhoto({ ...c, preview: URL.createObjectURL(c.blob) });
                } catch {
                  setError(t.requests.invalidImage);
                }
              }}
            />
          </label>
        </div>
        <Field label={t.workers.name}>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />}</Field>
        <Field label={t.workers.phone}>
          {(id) => <Input id={id} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" dir="ltr" className="text-left" required />}
        </Field>
        {!worker && (
          <Field label={t.workers.pin} hint={t.workers.pinHint}>
            {(id) => (
              <Input
                id={id}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                inputMode="numeric"
                autoComplete="off"
                dir="ltr"
                className="ltr-nums text-center text-xl tracking-[0.5em]"
                required
              />
            )}
          </Field>
        )}
        <label className="flex items-center gap-3">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="size-5 accent-brand-600" />
          <span className="font-medium">{t.workers.active}</span>
        </label>
        {error && (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">
            {error}
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
