import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { cn } from '@/src/lib/utils';
import Navbar from './Navbar';
import Sidebar from './Sidebar';
import Footer from './Footer';

interface AppShellProps {
  user: { name: string; email: string } | null;
  onLogout: () => void;
}

const PREF_KEY = 'sidebar_collapsed';
const readPref = () => {
  try { return localStorage.getItem(PREF_KEY) === '1'; } catch { return false; }
};

/** Authenticated layout: top bar + persistent left sidebar + routed page. */
export default function AppShell({ user, onLogout }: AppShellProps) {
  const { pathname, key } = useLocation();
  const isSession = pathname.startsWith('/session');

  const [pref, setPref] = useState(readPref);
  const [collapsed, setCollapsed] = useState(() => isSession || pref);
  const [mobileOpen, setMobileOpen] = useState(false);

  // A live interview needs the room: fold the sidebar to its rail on entry, restore the user's choice on exit.
  useEffect(() => { setCollapsed(isSession ? true : pref); }, [isSession]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close the mobile drawer on every navigation (location.key also changes when only router state changes).
  useEffect(() => { setMobileOpen(false); }, [key]);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    if (!isSession) {
      setPref(next);
      try { localStorage.setItem(PREF_KEY, next ? '1' : '0'); } catch { /* storage unavailable */ }
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar
        inShell
        showTimer={isSession && !pathname.startsWith('/session/resume/')}
        isAuthenticated
        onLogout={onLogout}
        onMenuClick={() => setMobileOpen(true)}
      />
      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={toggle}
        onExpand={() => setCollapsed(false)}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        onLogout={onLogout}
        user={user}
      />
      <div className={cn('flex-grow flex flex-col transition-[padding] duration-200', collapsed ? 'lg:pl-[72px]' : 'lg:pl-64')}>
        <main
          className={cn(
            'flex-grow w-full mx-auto pt-20 px-4 lg:px-6',
            !isSession && 'pb-12 max-w-7xl',
          )}
        >
          <Outlet />
        </main>
        {!isSession && <Footer />}
      </div>
    </div>
  );
}
