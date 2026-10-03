import { Navigate, Route, Routes } from 'react-router-dom';
import { DashboardPage } from './DashboardPage';
import { AuditLogPage, LoginLogsPage } from './LogsPages';
import { ManagersPage } from './ManagersPage';
import { NewRequestPage } from './NewRequestPage';
import { RequestDetailPage } from './RequestDetailPage';
import { RequestsPage } from './RequestsPage';
import { SettingsPage } from './SettingsPage';
import { StaffLayout } from './StaffLayout';
import { WorkersPage } from './WorkersPage';

/** Manager and system-admin dashboard. Routes a role may not use are not registered at all. */
export default function StaffRoutes({ isAdmin }: { isAdmin: boolean }) {
  return (
    <Routes>
      <Route path="/app" element={<StaffLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="workers" element={<WorkersPage />} />
        <Route path="requests" element={<RequestsPage mode={isAdmin ? 'history' : 'active'} />} />
        <Route path="requests/:id" element={<RequestDetailPage />} />
        {!isAdmin && (
          <>
            <Route path="history" element={<RequestsPage mode="history" />} />
            <Route path="requests/new" element={<NewRequestPage />} />
            <Route path="requests/:id/edit" element={<NewRequestPage />} />
          </>
        )}
        {isAdmin && (
          <>
            <Route path="managers" element={<ManagersPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="logins" element={<LoginLogsPage />} />
            <Route path="audit" element={<AuditLogPage />} />
          </>
        )}
      </Route>
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
