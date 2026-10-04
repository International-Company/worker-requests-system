import { useQueryClient } from '@tanstack/react-query';
import { Check, ImagePlus, Search, Send, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { PresenceLabel } from '../components/Presence';
import { useToast } from '../components/Toast';
import { Button, Card, cx, ErrorBox, Field, Input, PageHeader, Spinner } from '../components/ui';
import { t } from '../i18n';
import { attachmentUrl, errorMessage, patch } from '../lib/api';
import { uuid } from '../lib/device';
import { ACCEPTED_TYPES, compressImage, ImageRejected, MAX_IMAGES } from '../lib/image-compress';
import type { RequestView, TargetType } from '../lib/types';
import { db } from '../offline/db';
import { enqueueRequest, sendOne, uploadImage } from '../offline/outbox';
import { requestBackgroundSync } from '../pwa/sw-bridge';
import { useRequest, useWorkers } from './queries';

/** An image is either already on the server (edit mode) or a local compressed blob. */
type FormImage = { key: string; existingId?: string; blob?: Blob; name?: string; preview: string };

const DRAFT_ID = 'new-request';

/**
 * "إرسال طلب جديد" — title → workers → images → send. Also used for editing.
 * New requests go through the offline outbox (idempotent, survives network loss);
 * the unsent form is autosaved as a draft.
 */
export function NewRequestPage() {
  const { id: editId } = useParams();
  const editing = Boolean(editId);
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const workers = useWorkers();
  const existing = useRequest(editId);

  const [title, setTitle] = useState('');
  const [targetType, setTargetType] = useState<TargetType>('SINGLE');
  const [selected, setSelected] = useState<string[]>([]);
  const [images, setImages] = useState<FormImage[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const draftLoaded = useRef(false);
  // Stable key for this submission: double clicks / retries can never create two requests.
  const idempotencyKey = useRef(uuid());
  // Background uploads started as soon as an image is picked (key → attachment id, or null if it failed).
  const preUploads = useRef(new Map<string, Promise<string | null>>());

  /** Starts uploading right away so pressing "إرسال" only has to create the request. */
  function preUpload(key: string, blob: Blob, name: string) {
    if (!navigator.onLine || preUploads.current.has(key)) return;
    preUploads.current.set(key, uploadImage(key, blob, name).catch(() => null));
  }

  /** Waits for the background uploads of these images; returns the ids that finished. */
  async function uploadedIds(keys: string[]): Promise<Map<string, string>> {
    const done = new Map<string, string>();
    await Promise.all(
      keys.map(async (key) => {
        const id = await preUploads.current.get(key);
        if (id) done.set(key, id);
      }),
    );
    return done;
  }

  // Edit mode: load the request.
  useEffect(() => {
    if (!existing.data) return;
    setTitle(existing.data.title);
    setTargetType(existing.data.targetType);
    setSelected(existing.data.recipients.map((r) => r.workerId));
    setImages(existing.data.attachments.map((a) => ({ key: a.id, existingId: a.id, preview: attachmentUrl(a.id, 'thumb') })));
  }, [existing.data]);

  // New mode: restore the autosaved draft once.
  useEffect(() => {
    if (editing || !user || draftLoaded.current) return;
    draftLoaded.current = true;
    void db.drafts.get(DRAFT_ID).then((d) => {
      if (!d || d.userId !== user.id || (!d.title && !d.images.length)) return;
      setTitle(d.title);
      setTargetType(d.targetType);
      setSelected(d.workerIds);
      setImages(d.images.map((i) => ({ key: i.clientUploadId, blob: i.blob, name: i.name, preview: URL.createObjectURL(i.blob) })));
      d.images.forEach((i) => preUpload(i.clientUploadId, i.blob, i.name));
      toast.info(t.requests.draftRestored);
    });
  }, [editing, user, toast]);

  // Autosave draft (new mode).
  useEffect(() => {
    if (editing || !user || !draftLoaded.current) return;
    const id = setTimeout(() => {
      void db.drafts.put({
        id: DRAFT_ID,
        userId: user.id,
        title,
        targetType,
        workerIds: selected,
        images: images.filter((i) => i.blob).map((i) => ({ clientUploadId: i.key, blob: i.blob!, name: i.name ?? 'image.jpg' })),
        updatedAt: Date.now(),
      });
    }, 400);
    return () => clearTimeout(id);
  }, [editing, user, title, targetType, selected, images]);

  const activeWorkers = useMemo(() => (workers.data ?? []).filter((w) => w.isActive), [workers.data]);
  const visibleWorkers = activeWorkers.filter((w) => !search || w.name.includes(search.trim()));

  const titleError = touched && title.trim().length < 2 ? t.requests.titleRequired : null;
  const targetsError =
    touched && !editing && targetType !== 'ALL' && selected.length === 0 ? t.requests.chooseAtLeastOne : null;

  function toggleWorker(id: string) {
    if (targetType === 'SINGLE') setSelected([id]);
    else setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function addFiles(files: FileList | null) {
    if (!files) return;
    setError(null);
    for (const file of Array.from(files)) {
      if (images.length >= MAX_IMAGES) {
        setError(t.requests.maxImages);
        break;
      }
      try {
        const { blob, name } = await compressImage(file);
        const key = uuid();
        setImages((prev) => (prev.length >= MAX_IMAGES ? prev : [...prev, { key, blob, name, preview: URL.createObjectURL(blob) }]));
        preUpload(key, blob, name);
      } catch (e) {
        setError(e instanceof ImageRejected ? t.requests.invalidImage : t.common.genericError);
      }
    }
  }

  async function submit() {
    setTouched(true);
    if (title.trim().length < 2 || (!editing && targetType !== 'ALL' && selected.length === 0) || !user) return;
    setBusy(true);
    setError(null);
    try {
      if (editing && existing.data) {
        // Edit: new images are usually already uploaded in the background; upload any missing ones in parallel.
        const pre = await uploadedIds(images.filter((i) => !i.existingId).map((i) => i.key));
        const ids = await Promise.all(
          images.map((img) => img.existingId ?? pre.get(img.key) ?? uploadImage(img.key, img.blob!, img.name ?? 'image.jpg')),
        );
        await patch<RequestView>(`/requests/${existing.data.id}`, { title: title.trim(), attachmentIds: ids });
        toast.success(t.requests.edited);
        void qc.invalidateQueries({ queryKey: ['request'] });
        void qc.invalidateQueries({ queryKey: ['requests'] });
        navigate(`/app/requests/${existing.data.id}`);
        return;
      }

      // New: persist to the outbox first (never lost), then deliver now.
      const pre = await uploadedIds(images.map((i) => i.key));
      await enqueueRequest({
        userId: user.id,
        idempotencyKey: idempotencyKey.current,
        title: title.trim(),
        targetType,
        workerIds: targetType === 'ALL' ? [] : selected,
        images: images.map((i) => ({ clientUploadId: i.key, blob: i.blob!, name: i.name ?? 'image.jpg', attachmentId: pre.get(i.key) })),
      });
      await db.drafts.delete(DRAFT_ID);
      const outcome = await sendOne(idempotencyKey.current);
      void qc.invalidateQueries({ queryKey: ['requests'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      if (outcome.kind === 'sent') {
        toast.success(t.requests.sent);
        navigate(`/app/requests/${outcome.request.id}`);
      } else if (outcome.kind === 'queued') {
        toast.info(t.requests.queuedOffline);
        void requestBackgroundSync();
        navigate('/app/requests');
      } else {
        setError(outcome.message);
        navigate('/app/requests');
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (editing && existing.isLoading) return <Spinner />;
  if (editing && existing.isError) return <ErrorBox message={errorMessage(existing.error)} />;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={editing ? t.requests.editTitle : t.requests.newTitle} />
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Card className="space-y-5 p-5">
          <Field label={t.requests.title} error={titleError}>
            {(id) => (
              <Input
                id={id}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t.requests.titlePlaceholder}
                maxLength={200}
                autoFocus={!editing}
                className="h-12 text-lg"
              />
            )}
          </Field>

          {!editing && (
            <div className="space-y-3">
              <p className="text-sm font-semibold">{t.requests.targets}</p>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t.requests.targets}>
                {(
                  [
                    ['SINGLE', t.requests.targetSingle],
                    ['MULTIPLE', t.requests.targetMultiple],
                    ['ALL', t.requests.targetAll],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={targetType === value}
                    onClick={() => {
                      setTargetType(value);
                      if (value === 'SINGLE') setSelected((s) => s.slice(0, 1));
                    }}
                    className={cx(
                      'h-12 rounded-lg border text-[15px] font-semibold',
                      targetType === value ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white hover:bg-brand-50',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {targetType !== 'ALL' && (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={targetType === 'SINGLE' ? t.requests.chooseWorker : t.requests.chooseWorkers}
                      className="pr-9"
                      aria-label={t.common.search}
                    />
                  </div>
                  {workers.isLoading ? (
                    <Spinner />
                  ) : (
                    <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-lg border border-line">
                      {visibleWorkers.map((w) => {
                        const on = selected.includes(w.id);
                        return (
                          <li key={w.id}>
                            <button
                              type="button"
                              onClick={() => toggleWorker(w.id)}
                              aria-pressed={on}
                              className={cx('flex w-full items-center gap-3 px-3 py-3 text-right', on ? 'bg-brand-50' : 'hover:bg-surface')}
                            >
                              <span
                                className={cx(
                                  'flex size-6 shrink-0 items-center justify-center border-2',
                                  targetType === 'SINGLE' ? 'rounded-full' : 'rounded-md',
                                  on ? 'border-brand-600 bg-brand-600 text-white' : 'border-line',
                                )}
                              >
                                {on && <Check className="size-4" />}
                              </span>
                              <span className="flex-1 font-medium">{w.name}</span>
                              <PresenceLabel online={w.isOnline} lastSeenAt={w.lastSeenAt} hasDevice={Boolean(w.device)} />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {targetsError && <p className="text-sm text-red-700">{targetsError}</p>}
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm font-semibold">{t.requests.images}</p>
            <p className="text-xs text-muted">{t.requests.imagesHint}</p>
            <div className="grid grid-cols-3 gap-3">
              {images.map((img) => (
                <div key={img.key} className="relative overflow-hidden rounded-lg border border-line bg-surface">
                  <img src={img.preview} alt="" className="aspect-square w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setImages((prev) => prev.filter((x) => x.key !== img.key))}
                    className="absolute left-1.5 top-1.5 flex size-8 items-center justify-center rounded-full bg-black/60 text-white"
                    aria-label={t.requests.removeImage}
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ))}
              {images.length < MAX_IMAGES && (
                <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-brand-200 text-brand-700 hover:bg-brand-50">
                  <ImagePlus className="size-8" aria-hidden />
                  <span className="text-sm font-semibold">{t.requests.addImage}</span>
                  <input
                    type="file"
                    accept={ACCEPTED_TYPES.join(',')}
                    multiple
                    className="sr-only"
                    onChange={(e) => {
                      void addFiles(e.target.files);
                      e.target.value = '';
                    }}
                  />
                </label>
              )}
            </div>
          </div>
        </Card>

        {error && (
          <p className="rounded-lg bg-red-50 p-3 text-red-800" role="alert">
            {error}
          </p>
        )}

        <div className="sticky bottom-0 -mx-4 border-t border-line bg-white/95 px-4 py-3 md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
          <Button type="submit" size="lg" className="w-full md:w-auto md:min-w-48" loading={busy} icon={<Send className="size-5" />}>
            {busy ? t.requests.sending : editing ? t.requests.saveEdit : t.requests.send}
          </Button>
        </div>
      </form>
    </div>
  );
}
