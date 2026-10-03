import {
  ClipboardList,
  FileClock,
  History,
  LayoutDashboard,
  LogIn,
  LogOut,
  Menu,
  PanelRightClose,
  PanelRightOpen,
  Send,
  Settings,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { AppBanners } from '../components/AppBanners';
import { ConfirmDialog, cx, IconButton } from '../components/ui';
import { useLiveEvents } from '../hooks/useLiveEvents';
import { t } from '../i18n';
import type { Role } from '../lib/types';
import { useOutboxFlusher } from './useOutbox';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

/** Only the items the role may use are rendered (the API enforces the same rules). */
function navFor(role: Role): NavItem[] {
  if (role === 'SYSTEM_ADMIN') {
    return [
      { to: '/app', label: t.nav.dashboard, icon: <LayoutDashboard />, end: true },
      { to: '/app/workers', label: t.nav.workers, icon: <Users /> },
      { to: '/app/managers', label: t.nav.managers, icon: <ShieldCheck /> },
      { to: '/app/requests', label: t.nav.requests, icon: <ClipboardList /> },
      { to: '/app/settings', label: t.nav.settings, icon: <Settings /> },
      { to: '/app/logins', label: t.nav.loginLog, icon: <LogIn /> },
      { to: '/app/audit', label: t.nav.auditLog, icon: <FileClock /> },
    ];
  }
  return [
    { to: '/app', label: t.nav.dashboard, icon: <LayoutDashboard />, end: true },
    { to: '/app/workers', label: t.nav.workers, icon: <Users /> },
    { to: '/app/requests/new', label: t.nav.newRequest, icon: <Send /> },
    { to: '/app/requests', label: t.nav.requests, icon: <ClipboardList />, end: true },
    { to: '/app/history', label: t.nav.history, icon: <History /> },
  ];
}

const COLLAPSE_KEY = 'wr.sidebarCollapsed';

export function StaffLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const [drawer, setDrawer] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  useLiveEvents(Boolean(user));
  useOutboxFlusher(user?.role === 'MANAGER' ? user.id : null);

  useEffect(() => setDrawer(false), [location.pathname]);
  useEffect(() => localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'), [collapsed]);

  if (!user) return null;
  const items = navFor(user.role);

  const nav = (compact: boolean) => (
    <nav className="flex flex-col gap-1 p-2" aria-label={t.common.menu}>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          title={compact ? item.label : undefined}
          className={({ isActive }) =>
            cx(
              'flex h-11 items-center gap-3 rounded-lg px-3 text-[15px] font-medium transition-colors [&>svg]:size-5 [&>svg]:shrink-0',
              isActive ? 'bg-brand-600 text-white' : 'text-ink hover:bg-brand-50 hover:text-brand-700',
              compact && 'justify-center px-0',
            )
          }
        >
          {item.icon}
          {!compact && <span>{item.label}</span>}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-full">
      {/* Desktop / tablet sidebar (collapsible) */}
      <aside
        className={cx(
          'sticky top-0 hidden h-screen shrink-0 flex-col border-l border-line bg-white transition-[width] md:flex',
          collapsed ? 'w-[4.5rem]' : 'w-64',
        )}
      >
        <div className={cx('flex h-16 items-center border-b border-line px-3', collapsed ? 'justify-center' : 'justify-between')}>
          {!collapsed && <span className="truncate text-base font-bold text-brand-700">{t.appName}</span>}
          <IconButton label={collapsed ? t.common.expand : t.common.collapse} onClick={() => setCollapsed((c) => !c)}>
            {collapsed ? <PanelRightOpen className="size-5" /> : <PanelRightClose className="size-5" />}
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto">{nav(collapsed)}</div>
        <UserBox compact={collapsed} name={user.name} role={user.role} onLogout={() => setConfirmLogout(true)} />
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setDrawer(false)} aria-hidden />
          <aside className="absolute inset-y-0 right-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl">
            <div className="flex h-16 items-center justify-between border-b border-line px-3">
              <span className="font-bold text-brand-700">{t.appName}</span>
              <IconButton label={t.common.close} onClick={() => setDrawer(false)}>
                <X className="size-5" />
              </IconButton>
            </div>
            <div className="flex-1 overflow-y-auto">{nav(false)}</div>
            <UserBox name={user.name} role={user.role} onLogout={() => setConfirmLogout(true)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="safe-top sticky top-0 z-30 bg-white md:hidden">
          <AppBanners />
          <div className="flex h-14 items-center gap-2 border-b border-line px-2">
            <IconButton label={t.common.menu} onClick={() => setDrawer(true)}>
              <Menu className="size-6" />
            </IconButton>
            <span className="font-bold text-brand-700">{t.appName}</span>
          </div>
        </header>
        <div className="hidden md:block">
          <AppBanners />
        </div>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-8">
          <Outlet />
        </main>
      </div>

      <ConfirmDialog
        open={confirmLogout}
        title={t.common.logout}
        message={`${t.common.logout}؟`}
        confirmLabel={t.common.logout}
        onClose={() => setConfirmLogout(false)}
        onConfirm={() => void logout()}
      />
    </div>
  );
}

function UserBox({ name, role, compact, onLogout }: { name: string; role: Role; compact?: boolean; onLogout: () => void }) {
  return (
    <div className={cx('flex items-center gap-2 border-t border-line p-3', compact && 'justify-center')}>
      {!compact && (
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{name}</p>
          <p className="text-xs text-muted">{t.roles[role]}</p>
        </div>
      )}
      <IconButton label={t.common.logout} onClick={onLogout}>
        <LogOut className="size-5" />
      </IconButton>
    </div>
  );
}
