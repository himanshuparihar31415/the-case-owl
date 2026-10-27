import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import Dashboard from './pages/Dashboard';
import Library from './pages/Library';
import Config from './pages/Config';
import Session from './pages/Session';
import Report from './pages/Report';
import Learn from './pages/Learn';
import Lesson from './pages/Lesson';
import Billing from './pages/Billing';
import Landing from './pages/Landing';
import Home from './pages/Home';
import Companies from './pages/companies/Companies';
import CompanyLayout from './pages/companies/CompanyLayout';
import CompanyOverview from './pages/companies/CompanyOverview';
import CompanyKnow from './pages/companies/CompanyKnow';
import CompanyLearn from './pages/companies/CompanyLearn';
import CompanyLesson from './pages/companies/CompanyLesson';
import CompanyMock from './pages/companies/CompanyMock';
import GroupDiscussion from './pages/interview/GroupDiscussion';
import ResumeInterview from './pages/interview/ResumeInterview';
import ResumeSession from './pages/interview/ResumeSession';
import GeneralInterview from './pages/interview/GeneralInterview';
import RequestAccess from './pages/RequestAccess';
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
  // Marketing pages are self-contained (own nav, no app chrome).
  const isLanding = location.pathname === '/' || location.pathname === '/request-access';

  if (!authChecked) {
    return null; // Brief loading flash while validating token
  }

  if (isAuthenticated && isLanding) {
    return <Navigate to="/home" replace />;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onLogin={handleLogin}
      />
      <Routes>
        {/* Landing is a self-contained marketing page with its own nav/footer. */}
        <Route path="/" element={<Landing onOpenAuth={() => setIsAuthModalOpen(true)} />} />
        <Route path="/request-access" element={<RequestAccess onOpenAuth={() => setIsAuthModalOpen(true)} />} />

        {/* Everything else is authenticated and shares the sidebar shell. */}
        <Route element={isAuthenticated ? <AppShell user={user} onLogout={handleLogout} /> : <Navigate to="/" replace />}>
          <Route path="/home" element={<Home user={user} />} />
          <Route path="/dashboard" element={<Dashboard user={user} />} />
          <Route path="/library" element={<Library />} />
          {/* Keyed per navigation so Case -> Guesstimate re-reads the module passed via router state. */}
          <Route path="/config" element={<ConfigRoute />} />
          <Route path="/session/:sessionId" element={<Session />} />
          <Route path="/session/resume/:sessionId" element={<ResumeSession />} />
          <Route path="/report/:sessionId" element={<Report />} />
          <Route path="/report/resume/:sessionId" element={<Report />} />
          <Route path="/learn" element={<Learn />} />
          <Route path="/lesson/:habitTag" element={<Lesson />} />
          <Route path="/billing" element={<Billing user={user} />} />
          <Route path="/interview/gd" element={<GroupDiscussion />} />
          <Route path="/interview/resume" element={<ResumeInterview />} />
          <Route path="/interview/general" element={<GeneralInterview />} />
          <Route path="/companies" element={<Companies />} />
          <Route path="/companies/:companyId" element={<CompanyLayout />}>
            <Route index element={<CompanyOverview />} />
            <Route path="know" element={<CompanyKnow />} />
            <Route path="learn" element={<CompanyLearn />} />
            <Route path="learn/:lessonId" element={<CompanyLesson />} />
            <Route path="mock" element={<CompanyMock />} />
          </Route>
          <Route path="/settings" element={<div className="py-20 text-center text-secondary">Settings module coming soon.</div>} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

function ConfigRoute() {
  return <Config key={useLocation().key} />;
}

export default function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}
