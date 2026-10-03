import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useToast } from '../components/Toast';
import { Button, Dialog, Field, Input } from '../components/ui';
import { t } from '../i18n';
import { errorMessage, post } from '../lib/api';

/** Sets a new 4-digit PIN (worker or staff). The PIN is never shown back afterwards. */
export function PinDialog({ open, name, path, onClose }: { open: boolean; name: string; path: string; onClose: () => void }) {
  const toast = useToast();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setPin('');
      setError(null);
    }
  }, [open]);

  const save = useMutation({
    mutationFn: () => post(path, { pin }),
    onSuccess: () => {
      toast.success(t.workers.pinChanged);
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`${t.workers.changePin} — ${name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!/^\d{4}$/.test(pin)}>
            {t.common.save}
          </Button>
        </>
      }
    >
      <Field label={t.workers.newPin} hint={t.workers.pinHint} error={error}>
        {(id) => (
          <Input
            id={id}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            inputMode="numeric"
            autoComplete="off"
            dir="ltr"
            autoFocus
            className="ltr-nums text-center text-2xl tracking-[0.5em]"
          />
        )}
      </Field>
    </Dialog>
  );
}
