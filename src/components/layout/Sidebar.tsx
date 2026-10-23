import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  BookOpen, Mic, Building2, ChevronDown, PanelLeftClose, PanelLeftOpen, X,
  LayoutDashboard, CreditCard, Settings, LogOut,
  Briefcase, Calculator, Users, FileText, MessageSquare, Clock,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/src/lib/utils';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onExpand: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onLogout: () => void;
  user: { name: string; email: string } | null;
}

interface Leaf {
  label: string;
  to: string;
  Icon: LucideIcon;
  state?: { module: string };
  soon?: boolean;
  active: (path: string, module: string | undefined) => boolean;
}

// Case + Guesstimate reuse the existing /config flow (module preselected via router state).
// The case library is part of the Case flow, so it keeps this item lit.
const INTERVIEW_CHILDREN: Leaf[] = [
  { label: 'Case Interview', to: '/config', state: { module: 'case' }, Icon: Briefcase, active: (p, m) => (p === '/config' && (m ?? 'case') === 'case') || p === '/library' },
  { label: 'Guesstimate', to: '/config', state: { module: 'guesstimate' }, Icon: Calculator, active: (p, m) => p === '/config' && m === 'guesstimate' },
  { label: 'Group Discussion (GD)', to: '/interview/gd', Icon: Users, soon: true, active: (p) => p === '/interview/gd' },
  { label: 'Resume-Based Interview', to: '/interview/resume', Icon: FileText, active: (p) => p === '/interview/resume' || p.startsWith('/session/resume/') },
  { label: 'General Interview', to: '/interview/general', Icon: MessageSquare, soon: true, active: (p) => p === '/interview/general' },
];

const SECONDARY: Array<{ label: string; to: string; Icon: LucideIcon }> = [
  { label: 'Billing', to: '/billing', Icon: CreditCard },
  { label: 'Settings', to: '/settings', Icon: Settings },
];

function SidebarBody({
  collapsed, onNavigate, onExpand, onLogout, user,
}: { collapsed: boolean; onNavigate: () => void; onExpand: () => void; onLogout: () => void; user: SidebarProps['user'] }) {
  const { pathname, state } = useLocation();
  const module = (state as { module?: string } | null)?.module;

  const dashActive = pathname === '/dashboard' || pathname.startsWith('/dashboard/');
  const prepActive = pathname.startsWith('/learn') || pathname.startsWith('/lesson/');
  const companiesActive = pathname.startsWith('/companies');
  // /config is the front door of the interview flow, whichever module is picked inside it.
  const interviewActive = pathname === '/config' || INTERVIEW_CHILDREN.some((c) => c.active(pathname, module));

  const [interviewOpen, setInterviewOpen] = useState(interviewActive);
  // Reveal the children whenever the user lands somewhere inside the group.
  useEffect(() => { if (interviewActive) setInterviewOpen(true); }, [interviewActive]);

  const primaryRow = (active: boolean) => cn(
    'w-full flex items-center gap-3 rounded-xl text-left transition-colors',
    collapsed ? 'justify-center p-2' : 'px-2.5 py-2',
    active ? 'bg-primary text-on-primary' : 'text-primary hover:bg-surface-container-low',
  );
  const tile = (active: boolean) => cn(
    'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
    active ? 'bg-white/15 text-white' : 'bg-on-tertiary-container/10 text-on-tertiary-container',
  );

  return (
    <div className="flex flex-col h-full">
      <nav className="flex-1 overflow-y-auto scrolling-log px-3 pt-3 space-y-1" aria-label="Main">
        {/* 0. Dashboard — home base, sits above the three practice modules */}
        <Link to="/dashboard" onClick={onNavigate} title="Dashboard" className={primaryRow(dashActive)}>
          <span className={tile(dashActive)}><LayoutDashboard className="w-[18px] h-[18px]" /></span>
          {!collapsed && <span className="font-headline font-bold text-sm">Dashboard</span>}
        </Link>

        {/* 1. Preparation */}
        <Link to="/learn" onClick={onNavigate} title="Preparation" className={primaryRow(prepActive)}>
          <span className={tile(prepActive)}><BookOpen className="w-[18px] h-[18px]" /></span>
          {!collapsed && <span className="font-headline font-bold text-sm">Preparation</span>}
        </Link>

        {/* 2. Interview (expandable) */}
        <div>
          <button
            type="button"
            title="Interview"
            aria-expanded={interviewOpen}
            onClick={() => {
              if (collapsed) { onExpand(); setInterviewOpen(true); } else setInterviewOpen((o) => !o);
            }}
            className={primaryRow(interviewActive && !interviewOpen)}
          >
            <span className={tile(interviewActive && !interviewOpen)}><Mic className="w-[18px] h-[18px]" /></span>
            {!collapsed && (
              <>
                <span className="font-headline font-bold text-sm flex-1">Interview</span>
                <ChevronDown className={cn('w-4 h-4 transition-transform', interviewOpen && 'rotate-180')} />
              </>
            )}
          </button>

          <AnimatePresence initial={false}>
            {!collapsed && interviewOpen && (
              <motion.ul
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="overflow-hidden ml-[22px] mt-1 pl-3 border-l border-outline-variant/40 space-y-0.5"
              >
                {INTERVIEW_CHILDREN.map((c) => {
                  const active = c.active(pathname, module);
                  return (
                    <li key={c.label}>
                      <Link
                        to={c.to}
                        state={c.state}
                        onClick={onNavigate}
                        className={cn(
                          'flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[13px] transition-colors',
                          active ? 'bg-on-tertiary-container/10 text-primary font-bold' : 'text-secondary font-medium hover:text-primary hover:bg-surface-container-low',
                        )}
                      >
                        <c.Icon className={cn('w-4 h-4 shrink-0', active && 'text-on-tertiary-container')} />
                        <span className="flex-1">{c.label}</span>
                        {c.soon && <Clock className="w-3 h-3 shrink-0 opacity-50" aria-label="Coming soon"><title>Coming soon</title></Clock>}
                      </Link>
                    </li>
                  );
                })}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>

        {/* 3. Company-Specific Interview */}
        <Link to="/companies" onClick={onNavigate} title="Company-Specific Interview" className={primaryRow(companiesActive)}>
          <span className={tile(companiesActive)}>
            <Building2 className="w-[18px] h-[18px]" />
          </span>
          {!collapsed && <span className="font-headline font-bold text-sm leading-tight">Company-Specific Interview</span>}
        </Link>
      </nav>

      {/* Secondary: muted utilities */}
      <div className="px-3 pb-3 pt-2 border-t border-outline-variant/15 space-y-0.5">
        {!collapsed && user && (
          <div className="px-2.5 pb-2 min-w-0">
            <div className="text-[12px] font-semibold text-primary truncate">{user.name}</div>
            <div className="text-[11px] text-secondary/70 truncate">{user.email}</div>
          </div>
        )}
        {SECONDARY.map(({ label, to, Icon }) => {
          const active = pathname === to || pathname.startsWith(to + '/');
          return (
            <Link
              key={to}
              to={to}
              onClick={onNavigate}
              title={label}
              className={cn(
                'flex items-center gap-2.5 rounded-lg text-[13px] transition-colors',
                collapsed ? 'justify-center p-2' : 'px-2.5 py-1.5',
                active ? 'text-primary font-bold bg-surface-container-low' : 'text-secondary font-medium hover:text-primary hover:bg-surface-container-low',
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {!collapsed && label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={onLogout}
          title="Sign out"
          className={cn(
            'w-full flex items-center gap-2.5 rounded-lg text-[13px] font-medium text-secondary hover:text-error hover:bg-error-container/20 transition-colors',
            collapsed ? 'justify-center p-2' : 'px-2.5 py-1.5',
          )}
        >
          <LogOut className="w-4 h-4 shrink-0" />
          {!collapsed && 'Sign out'}
        </button>
      </div>
    </div>
  );
}

export default function Sidebar({ collapsed, onToggleCollapsed, onExpand, mobileOpen, onCloseMobile, onLogout, user }: SidebarProps) {
  return (
    <>
      {/* Desktop: persistent, collapsible rail */}
      <aside
        className={cn(
          'hidden lg:flex flex-col fixed left-0 top-16 bottom-0 z-40 bg-surface-container-lowest border-r border-outline-variant/15 transition-[width] duration-200',
          collapsed ? 'w-[72px]' : 'w-64',
        )}
      >
        <div className={cn('flex px-3 pt-2', collapsed ? 'justify-center' : 'justify-end')}>
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-surface-container-low transition"
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>
        <div className="flex-1 min-h-0">
          <SidebarBody collapsed={collapsed} onNavigate={() => {}} onExpand={onExpand} onLogout={onLogout} user={user} />
        </div>
      </aside>

      {/* Mobile: hamburger drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <div className="lg:hidden fixed inset-0 z-[60]">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-primary/40"
              onClick={onCloseMobile}
            />
            <motion.aside
              initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
              transition={{ type: 'tween', duration: 0.2 }}
              className="absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] bg-surface-container-lowest shadow-xl flex flex-col"
              aria-label="Menu"
            >
              <div className="flex items-center justify-between px-4 h-16 border-b border-outline-variant/15 shrink-0">
                <span className="text-lg font-headline font-extrabold tracking-tighter text-primary">The Case Owl</span>
                <button onClick={onCloseMobile} aria-label="Close menu" className="p-2 rounded-full hover:bg-surface-container-low transition">
                  <X className="w-5 h-5 text-primary" />
                </button>
              </div>
              <div className="flex-1 min-h-0">
                <SidebarBody collapsed={false} onNavigate={onCloseMobile} onExpand={() => {}} onLogout={onLogout} user={user} />
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
