import { Navigate, Route, Routes } from 'react-router-dom';
import { WorkerAccountPage } from './WorkerAccountPage';
import { WorkerHomePage } from './WorkerHomePage';
import { WorkerLayout } from './WorkerLayout';
import { WorkerRequestPage } from './WorkerRequestPage';

/** Mobile-first worker experience: current / previous requests and account. */
export default function WorkerRoutes() {
  return (
    <Routes>
      <Route path="/worker" element={<WorkerLayout />}>
        <Route index element={<WorkerHomePage mode="current" />} />
        <Route path="history" element={<WorkerHomePage mode="previous" />} />
        <Route path="account" element={<WorkerAccountPage />} />
        <Route path="requests/:recipientId" element={<WorkerRequestPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/worker" replace />} />
    </Routes>
  );
}
