import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  UserCircle, Timer, LogOut, Coins, Infinity as InfinityIcon, Menu, X,
  LayoutDashboard, GraduationCap, Library, CreditCard, Settings,
} from 'lucide-react';
import { MagneticDock } from '@/src/components/ui/magnetic-dock';
import { cn } from '@/src/lib/utils';
import { api } from '@/src/lib/api';

interface NavbarProps {
  showTimer?: boolean;
  time?: string;
  isAuthenticated?: boolean;
  onLogout?: () => void;
  onLogin?: () => void;
  /** Inside the authenticated AppShell: the left sidebar owns navigation + sign-out. */
  inShell?: boolean;
  onMenuClick?: () => void;
}

export default function Navbar({ 
  showTimer, 
  time = "12:44", 
  isAuthenticated, 
  onLogout,
  onLogin,
  inShell,
  onMenuClick,
}: NavbarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [credits, setCredits] = useState<{ unlimited: boolean; spendable: number } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  // Show the live balance; refetch on route change so it updates after purchase/use.
  useEffect(() => {
    if (!isAuthenticated) { setCredits(null); return; }
    api.get<{ wallet: { unlimited: boolean; spendable: number } }>('/billing/wallet')
      .then((d) => setCredits({ unlimited: d.wallet.unlimited, spendable: d.wallet.spendable }))
      .catch(() => setCredits(null));
  }, [isAuthenticated, location.pathname]);

  const navItems = [
    { name: 'Dashboard', path: '/dashboard', Icon: LayoutDashboard },
    { name: 'Learn', path: '/learn', Icon: GraduationCap },
    { name: 'Library', path: '/library', Icon: Library },
    { name: 'Plans', path: '/billing', Icon: CreditCard },
    { name: 'Settings', path: '/settings', Icon: Settings },
  ];

  // A module stays highlighted on its sub-pages (lessons belong to Learn).
  const isActivePath = (path: string) =>
    location.pathname === path ||
    location.pathname.startsWith(path + '/') ||
    (path === '/learn' && location.pathname.startsWith('/lesson/'));

  return (
    <header className="fixed top-0 z-50 w-full glass-nav border-b border-outline-variant/15">
      <div className={cn("flex justify-between items-center w-full px-4 lg:px-8", inShell ? "h-16" : "py-3 max-w-7xl mx-auto")}>
        <Link to={isAuthenticated ? "/home" : "/"} className="text-xl font-headline font-extrabold tracking-tighter text-primary">
          The Case Owl
        </Link>

        {/* Primary nav — magnetic dock with labels under the icons (desktop) */}
        {isAuthenticated && !inShell && (
          <nav className="hidden md:flex items-start h-12" aria-label="Primary">
            <MagneticDock
              position="top"
              variant="transparent"
              labelPosition="below"
              iconSize={30}
              activeScale={1.2}
              maxScale={1.35}
              magneticDistance={110}
              className="p-0 gap-8 shadow-none"
              items={navItems.map(({ name, path, Icon }) => ({
                id: path,
                label: name,
                icon: <Icon className="w-full h-full text-primary" strokeWidth={2.2} />,
                isActive: isActivePath(path),
                onClick: () => navigate(path),
              }))}
            />
          </nav>
        )}

        {/* Previous text-link nav, replaced by the dock above — restore by removing this comment wrapper.
        {isAuthenticated && (
          <nav className="hidden md:flex items-center gap-6">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.name}
                  to={item.path}
                  className={cn(
                    "font-body text-sm transition-colors",
                    isActive
                      ? "text-primary border-b-2 border-primary pb-1 font-bold"
                      : "text-secondary font-medium hover:text-primary"
                  )}
                >
                  {item.name}
                </Link>
              );
            })}
          </nav>
        )}
        */}

        <div className="flex items-center gap-3">
          {showTimer && (
            <div className="flex items-center gap-2 bg-surface-container px-3 py-1.5 rounded-full">
              <Timer className="w-4 h-4 text-primary" />
              <span className="font-headline font-bold text-sm tracking-tight text-primary">{time}</span>
            </div>
          )}
          
          {isAuthenticated && credits && (
            <Link
              to="/billing"
              title="Your credits"
              className="hidden sm:flex items-center gap-1.5 bg-surface-container px-3 py-1.5 rounded-full hover:bg-surface-container-high transition-all"
            >
              {credits.unlimited ? (
                <><InfinityIcon className="w-4 h-4 text-on-tertiary-container" /><span className="font-headline font-bold text-sm text-primary">Unlimited</span></>
              ) : (
                <><Coins className="w-4 h-4 text-on-tertiary-container" /><span className="font-headline font-bold text-sm text-primary">{credits.spendable}</span><span className="text-xs text-secondary">min</span></>
              )}
            </Link>
          )}

          {isAuthenticated ? (
            <div className="flex items-center gap-1">
              <button className="p-2 rounded-full hover:bg-surface-container-low transition-all active:scale-95">
                <UserCircle className="w-6 h-6 text-primary" />
              </button>
              <button
                onClick={onLogout}
                className={cn("hidden md:inline-flex p-2 rounded-full hover:bg-error-container/20 text-error transition-all active:scale-95", inShell && "!hidden")}
                title="Sign Out"
              >
                <LogOut className="w-5 h-5" />
              </button>
              {/* Mobile menu toggle */}
              <button
                onClick={inShell ? onMenuClick : () => setMenuOpen((o) => !o)}
                className={cn("p-2 rounded-full hover:bg-surface-container-low transition active:scale-95", inShell ? "lg:hidden" : "md:hidden")}
                aria-label="Menu"
              >
                {menuOpen && !inShell ? <X className="w-6 h-6 text-primary" /> : <Menu className="w-6 h-6 text-primary" />}
              </button>
            </div>
          ) : (
            <button
              onClick={onLogin}
              className="bg-primary text-white px-6 py-2 rounded-full font-headline font-bold text-sm hover:bg-primary-container transition-all active:scale-95"
            >
              Sign In
            </button>
          )}
        </div>
      </div>

      {/* Mobile drawer */}
      {isAuthenticated && !inShell && menuOpen && (
        <div className="md:hidden border-t border-outline-variant/15 bg-surface-container-lowest shadow-lg">
          <nav className="flex flex-col px-4 py-2 max-w-7xl mx-auto">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.name}
                  to={item.path}
                  className={cn(
                    "font-body text-sm py-3 border-b border-outline-variant/10 last:border-0 transition-colors",
                    isActive ? "text-primary font-bold" : "text-secondary font-medium"
                  )}
                >
                  {item.name}
                </Link>
              );
            })}
            <button
              onClick={onLogout}
              className="flex items-center gap-2 text-sm py-3 text-error font-medium text-left"
            >
              <LogOut className="w-4 h-4" /> Sign Out
            </button>
          </nav>
        </div>
      )}
    </header>
  );
}
