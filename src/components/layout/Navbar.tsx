import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { UserCircle, Timer, LogOut } from 'lucide-react';
import { cn } from '@/src/lib/utils';

interface NavbarProps {
  showTimer?: boolean;
  time?: string;
  isAuthenticated?: boolean;
  onLogout?: () => void;
  onLogin?: () => void;
}

export default function Navbar({ 
  showTimer, 
  time = "12:44", 
  isAuthenticated, 
  onLogout,
  onLogin 
}: NavbarProps) {
  const location = useLocation();

  const navItems = [
    { name: 'Dashboard', path: '/dashboard' },
    { name: 'Library', path: '/library' },
    { name: 'Settings', path: '/settings' },
  ];

  return (
    <header className="fixed top-0 z-50 w-full glass-nav border-b border-outline-variant/15">
      <div className="flex justify-between items-center w-full px-8 py-4 max-w-7xl mx-auto">
        <Link to={isAuthenticated ? "/dashboard" : "/"} className="text-2xl font-headline font-extrabold tracking-tighter text-primary">
          The Case Owl
        </Link>
        
        {isAuthenticated && (
          <nav className="hidden md:flex items-center gap-8">
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

        <div className="flex items-center gap-4">
          {showTimer && (
            <div className="flex items-center gap-2 bg-surface-container px-3 py-1.5 rounded-full">
              <Timer className="w-4 h-4 text-primary" />
              <span className="font-headline font-bold text-sm tracking-tight text-primary">{time}</span>
            </div>
          )}
          
          {isAuthenticated ? (
            <div className="flex items-center gap-2">
              <button className="p-2 rounded-full hover:bg-surface-container-low transition-all active:scale-95">
                <UserCircle className="w-6 h-6 text-primary" />
              </button>
              <button 
                onClick={onLogout}
                className="p-2 rounded-full hover:bg-error-container/20 text-error transition-all active:scale-95"
                title="Sign Out"
              >
                <LogOut className="w-5 h-5" />
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
    </header>
  );
}
