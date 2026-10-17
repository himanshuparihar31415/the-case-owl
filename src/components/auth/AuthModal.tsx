import React, { useState } from 'react';
import { X, Mail, Lock, User, ArrowRight, Github, Chrome, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/src/lib/utils';
import { api } from '@/src/lib/api';
import { useNavigate } from 'react-router-dom';
import { BETA_INVITE_ONLY } from '@/src/lib/betaAccess';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLogin: (user: { name: string; email: string }) => void;
}

export default function AuthModal({ isOpen, onClose, onLogin }: AuthModalProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const endpoint = mode === 'signin' ? '/auth/login' : '/auth/signup';
      const body = mode === 'signin' ? { email, password } : { name, email, password };

      const data = await api.post<{ token: string; user: { name: string; email: string } }>(endpoint, body);

      localStorage.setItem('auth_token', data.token);
      onLogin(data.user);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const navigate = useNavigate();

  const handleModeSwitch = () => {
    // Private beta: no self-serve accounts — send people to the access request form.
    if (BETA_INVITE_ONLY && mode === 'signin') {
      onClose();
      navigate('/request-access');
      return;
    }
    setMode(mode === 'signin' ? 'signup' : 'signin');
    setError('');
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-primary/40 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden"
          >
            <button
              onClick={onClose}
              className="absolute top-6 right-6 p-2 rounded-full hover:bg-surface-container transition-colors text-secondary"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="p-10">
              <div className="text-center mb-10">
                <h2 className="font-headline text-3xl font-extrabold text-primary mb-2">
                  {mode === 'signin' ? 'Welcome Back' : 'Create Account'}
                </h2>
                <p className="font-body text-secondary text-sm">
                  {mode === 'signin'
                    ? 'Sign in to continue your case preparation'
                    : 'Join thousands of candidates mastering cases'}
                </p>
              </div>

              {error && (
                <div className="flex items-center gap-2 bg-error/10 border border-error/20 text-error rounded-xl px-4 py-3 mb-4 text-sm font-body">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                {mode === 'signup' && (
                  <div className="space-y-1">
                    <label className="label-blueprint text-[10px] ml-1">Full Name</label>
                    <div className="relative">
                      <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-outline-variant" />
                      <input
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Jane Smith"
                        className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl py-3 pl-12 pr-4 font-body text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-1">
                  <label className="label-blueprint text-[10px] ml-1">Email Address</label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-outline-variant" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="executive@firm.com"
                      className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl py-3 pl-12 pr-4 font-body text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="label-blueprint text-[10px] ml-1">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-outline-variant" />
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-xl py-3 pl-12 pr-4 font-body text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                    />
                  </div>
                </div>

                {mode === 'signin' && (
                  <div className="text-right">
                    <button type="button" className="text-[11px] font-bold text-on-tertiary-container hover:underline uppercase tracking-wider">
                      Forgot Password?
                    </button>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className={cn(
                    "w-full bg-primary text-white py-4 rounded-xl font-headline font-bold text-sm transition-all active:scale-95 flex items-center justify-center gap-2 mt-4",
                    loading ? "opacity-70 cursor-not-allowed" : "hover:bg-primary-container"
                  )}
                >
                  {loading ? 'Please wait…' : mode === 'signin' ? 'Sign In' : 'Create Account'}
                  {!loading && <ArrowRight className="w-4 h-4" />}
                </button>
              </form>

              <div className="relative my-8">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-outline-variant/10"></div>
                </div>
                <div className="relative flex justify-center text-[10px] uppercase tracking-widest font-bold">
                  <span className="bg-white px-4 text-secondary">Or continue with</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <button className="flex items-center justify-center gap-2 py-3 border border-outline-variant/20 rounded-xl hover:bg-surface-container transition-all active:scale-95">
                  <Chrome className="w-4 h-4" />
                  <span className="text-xs font-bold font-headline">Google</span>
                </button>
                <button className="flex items-center justify-center gap-2 py-3 border border-outline-variant/20 rounded-xl hover:bg-surface-container transition-all active:scale-95">
                  <Github className="w-4 h-4" />
                  <span className="text-xs font-bold font-headline">GitHub</span>
                </button>
              </div>

              <div className="mt-10 text-center">
                <p className="text-sm text-secondary font-body">
                  {mode === 'signin'
                    ? (BETA_INVITE_ONLY ? "Don't have access yet?" : "Don't have an account?")
                    : "Already have an account?"}{' '}
                  <button
                    onClick={handleModeSwitch}
                    className="text-on-tertiary-container font-bold hover:underline"
                  >
                    {mode === 'signin' ? (BETA_INVITE_ONLY ? 'Request beta access' : 'Sign Up') : 'Sign In'}
                  </button>
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
