import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../components/Toast';
import { t } from '../i18n';
import { errorMessage, post } from '../lib/api';
import { uuid } from '../lib/device';
import type { RequestView } from '../lib/types';

export type RequestAction = 'cancel' | 'resend' | 'reopen';

export const actionText: Record<RequestAction, { title: string; confirm: string; done: string }> = {
  cancel: { title: t.requests.cancelRequest, confirm: t.requests.cancelConfirm, done: t.requests.cancelled },
  resend: { title: t.requests.resend, confirm: t.requests.resendConfirm, done: t.requests.resent },
  reopen: { title: t.requests.reopen, confirm: t.requests.reopenConfirm, done: t.requests.reopened },
};

/** Cancel / resend (new request, idempotent) / reopen — each backed by the real API. */
export function useRequestAction() {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async ({ action, request, recipientIds }: { action: RequestAction; request: RequestView; recipientIds?: string[] }) => {
      if (action === 'cancel') return post<RequestView>(`/requests/${request.id}/cancel`);
      if (action === 'resend') return post<RequestView>(`/requests/${request.id}/resend`, { idempotencyKey: uuid() });
      return post<RequestView>(`/requests/${request.id}/reopen`, recipientIds ? { recipientIds } : {});
    },
    onSuccess: (result, { action }) => {
      toast.success(actionText[action].done);
      void qc.invalidateQueries({ queryKey: ['requests'] });
      void qc.invalidateQueries({ queryKey: ['request'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      if (action === 'resend') navigate(`/app/requests/${result.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export const canEdit = (r: RequestView) => r.status === 'ACTIVE';
export const canCancel = (r: RequestView) => r.status === 'ACTIVE' && (r.counts.NEW > 0 || r.counts.ACKNOWLEDGED > 0);
export const canReopen = (r: RequestView) => r.status === 'ACTIVE' && r.counts.COMPLETED > 0;
