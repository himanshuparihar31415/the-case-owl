import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { cn } from './lib/utils';
import Navbar from './components/layout/Navbar';
import Footer from './components/layout/Footer';
import Dashboard from './pages/Dashboard';
import Library from './pages/Library';
import Config from './pages/Config';
import Session from './pages/Session';
import Report from './pages/Report';
import Billing from './pages/Billing';
import Landing from './pages/Landing';
import AuthModal from './components/auth/AuthModal';
import { api } from './lib/api';

interface AuthUser {
  name: string;
  email: string;
}

function AppContent() {
  const location = useLocation();
  const [user, setUser] = useState<AuthUser | null>(null);
  // No token = no async check needed, start as already checked
  const [authChecked, setAuthChecked] = useState(() => !localStorage.getItem('auth_token'));
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  // On mount, validate stored JWT with the backend
  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!token) return; // authChecked already true from initial state
    api.get<{ user: AuthUser }>('/auth/me')
      .then((data) => setUser(data.user))
      .catch(() => {
        // Token expired or invalid — clear it
        localStorage.removeItem('auth_token');
      })
      .finally(() => setAuthChecked(true));
  }, []);

  const handleLogin = (userData: AuthUser) => {
    setUser(userData);
    setIsAuthModalOpen(false);
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('auth_token');
  };

  const isAuthenticated = user !== null;
  const isSession = location.pathname.startsWith('/session');
  const isLanding = location.pathname === '/';

  if (!authChecked) {
    return null; // Brief loading flash while validating token
  }

  if (isAuthenticated && isLanding) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onLogin={handleLogin}
      />
      {/* Landing is a self-contained marketing page with its own nav/footer. */}
      {!isLanding && (
        <Navbar
          showTimer={isSession}
          isAuthenticated={isAuthenticated}
          onLogout={handleLogout}
          onLogin={() => setIsAuthModalOpen(true)}
        />
      )}
      <main className={cn(
        "flex-grow w-full mx-auto",
        isLanding ? "" : isSession ? "pt-24 px-4 lg:px-6" : "pt-24 pb-20 px-8 max-w-7xl"
      )}>
        <Routes>
          <Route path="/" element={<Landing onOpenAuth={() => setIsAuthModalOpen(true)} />} />
          <Route
            path="/dashboard"
            element={isAuthenticated ? <Dashboard user={user} /> : <Navigate to="/" replace />}
          />
          <Route
            path="/library"
            element={isAuthenticated ? <Library /> : <Navigate to="/" replace />}
          />
          <Route
            path="/config"
            element={isAuthenticated ? <Config /> : <Navigate to="/" replace />}
          />
          <Route
            path="/session/:sessionId"
            element={isAuthenticated ? <Session /> : <Navigate to="/" replace />}
          />
          <Route
            path="/report/:sessionId"
            element={isAuthenticated ? <Report /> : <Navigate to="/" replace />}
          />
          <Route
            path="/billing"
            element={isAuthenticated ? <Billing user={user} /> : <Navigate to="/" replace />}
          />
          <Route path="/settings" element={<div className="py-20 text-center text-secondary">Settings module coming soon.</div>} />
        </Routes>
      </main>
      {!isSession && !isLanding && <Footer />}
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}
