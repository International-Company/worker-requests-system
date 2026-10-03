import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LoginPage } from '../pages/LoginPage';
import { StatusBadge } from './StatusBadge';
import { ToastProvider } from './Toast';

const login = vi.fn();
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ login, sessionEnded: false }) }));

describe('StatusBadge', () => {
  it.each([
    ['NEW', 'جديد'],
    ['ACKNOWLEDGED', 'تم الاستلام'],
    ['COMPLETED', 'تم التنفيذ'],
    ['CANCELLED', 'ملغى'],
  ] as const)('%s → %s', (status, label) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe('LoginPage', () => {
  it('submits automatically after 4 keypad digits and shows the Arabic error', async () => {
    login.mockRejectedValueOnce(Object.assign(new Error('رمز الدخول غير صحيح'), { name: 'ApiError' }));
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <LoginPage />
      </ToastProvider>,
    );
    expect(screen.getByRole('heading', { name: 'نظام طلبات العمال' })).toBeInTheDocument();
    for (const d of ['1', '2', '3', '4']) await user.click(screen.getByRole('button', { name: d }));
    expect(login).toHaveBeenCalledWith('1234');
    expect(await screen.findByRole('alert')).toHaveTextContent(/حدث خطأ|رمز الدخول/);
  });

  it('delete key removes the last digit', async () => {
    const user = userEvent.setup();
    login.mockClear();
    render(
      <ToastProvider>
        <LoginPage />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: '1' }));
    await user.click(screen.getByRole('button', { name: 'حذف' }));
    for (const d of ['5', '6', '7', '8']) await user.click(screen.getByRole('button', { name: d }));
    expect(login).toHaveBeenCalledWith('5678');
  });
});
