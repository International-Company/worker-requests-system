import { useQuery } from '@tanstack/react-query';
import { get, qs } from '../lib/api';
import type { DashboardStats, Paged, RequestDetail, RequestView, StaffAccount, Worker } from '../lib/types';

export interface RequestFilters {
  q?: string;
  workerId?: string;
  managerId?: string;
  status?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
  view?: 'all' | 'active';
}

export const useWorkers = () => useQuery({ queryKey: ['workers'], queryFn: () => get<Worker[]>('/workers'), refetchInterval: 30_000 });

export const useManagers = (enabled = true) =>
  useQuery({ queryKey: ['managers'], queryFn: () => get<StaffAccount[]>('/managers'), enabled });

export const useDashboard = () =>
  useQuery({ queryKey: ['dashboard'], queryFn: () => get<DashboardStats>('/dashboard/stats'), refetchInterval: 30_000 });

export const useRequests = (filters: RequestFilters) =>
  useQuery({
    queryKey: ['requests', filters],
    queryFn: () => get<Paged<RequestView>>(`/requests${qs({ ...filters })}`),
    placeholderData: (prev) => prev,
  });

export const useRequest = (id: string | undefined) =>
  useQuery({ queryKey: ['request', id], queryFn: () => get<RequestDetail>(`/requests/${id}`), enabled: Boolean(id) });
