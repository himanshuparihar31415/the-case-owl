import React from 'react';
import { ArrowRight, Shield, Zap, Target, BarChart3, Users, Globe } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '@/src/lib/utils';

interface LandingProps {
  onOpenAuth: () => void;
}

export default function Landing({ onOpenAuth }: LandingProps) {
  return (
    <div className="flex flex-col w-full -mt-24">
      {/* Hero Section */}
      <section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden pt-24 px-8">
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-on-tertiary-container/5 rounded-full blur-3xl animate-pulse delay-1000" />
        </div>

        <div className="max-w-4xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="label-blueprint mb-6 block">The Future of Case Preparation</span>
            <h1 className="power-gap-h1 text-primary mb-8">
              Master the Art of <br />
              <span className="text-on-tertiary-container">The Case Owl</span>
            </h1>
            <p className="font-body text-xl text-secondary mb-12 max-w-2xl mx-auto leading-relaxed">
              Architectural Authority AI provides the most advanced simulation environment for aspiring consultants and executives. Train with precision, receive real-time feedback, and dominate your next interview.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="flex flex-col sm:flex-row gap-4 justify-center"
          >
            <button
              onClick={onOpenAuth}
              className="bg-primary text-white px-8 py-4 rounded-full font-headline font-bold flex items-center justify-center gap-2 hover:bg-primary-container transition-all active:scale-95 shadow-lg shadow-primary/20"
            >
              Get Started Now <ArrowRight className="w-5 h-5" />
            </button>
            <button className="bg-white border border-outline-variant/30 text-primary px-8 py-4 rounded-full font-headline font-bold hover:bg-surface-container transition-all active:scale-95">
              View Case Library
            </button>
          </motion.div>
        </div>

        {/* Floating Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mt-24 w-full max-w-5xl">
          {[
            { label: 'Active Users', value: '12k+', icon: <Users className="w-5 h-5" /> },
            { label: 'Success Rate', value: '94%', icon: <Target className="w-5 h-5" /> },
            { label: 'Case Studies', value: '500+', icon: <Globe className="w-5 h-5" /> },
            { label: 'Avg. Score Imp.', value: '+42%', icon: <BarChart3 className="w-5 h-5" /> },
          ].map((stat, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 + i * 0.1 }}
              className="no-line-card p-6 text-center flex flex-col items-center"
            >
              <div className="text-on-tertiary-container mb-3">{stat.icon}</div>
              <div className="font-headline font-extrabold text-2xl text-primary">{stat.value}</div>
              <div className="label-blueprint mt-1">{stat.label}</div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Features Section */}
      <section className="py-32 px-8 bg-surface-container-low">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-20">
            <span className="label-blueprint">Core Capabilities</span>
            <h2 className="text-4xl font-headline font-extrabold text-primary mt-4">Built for High-Stakes Performance</h2>
          </div>

          <div className="grid md:grid-cols-3 gap-12">
            {[
              {
                title: 'AI-Driven Simulations',
                desc: 'Engage in dynamic, voice-enabled case interviews that adapt to your logic and structure.',
                icon: <Zap className="w-10 h-10 text-on-tertiary-container" />
              },
              {
                title: 'Structural Integrity',
                desc: 'Our proprietary algorithms analyze your frameworks for logical consistency and exhaustive depth.',
                icon: <Shield className="w-10 h-10 text-on-tertiary-container" />
              },
              {
                title: 'Executive Reporting',
                desc: 'Receive detailed post-session analytics on your business judgment, math accuracy, and creativity.',
                icon: <BarChart3 className="w-10 h-10 text-on-tertiary-container" />
              }
            ].map((feature, i) => (
              <div key={i} className="flex flex-col gap-6">
                <div className="bg-white w-20 h-20 rounded-2xl flex items-center justify-center shadow-sm border border-outline-variant/10">
                  {feature.icon}
                </div>
                <h3 className="text-2xl font-headline font-bold text-primary">{feature.title}</h3>
                <p className="font-body text-secondary leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Social Proof / Logo Cloud */}
      <section className="py-20 px-8 border-y border-outline-variant/10">
        <div className="max-w-7xl mx-auto text-center">
          <p className="label-blueprint mb-12">Trusted by candidates at top-tier firms</p>
          <div className="flex flex-wrap justify-center gap-12 md:gap-24 opacity-40 grayscale">
            {['McKinsey', 'BCG', 'Bain', 'Goldman Sachs', 'Morgan Stanley'].map((firm) => (
              <span key={firm} className="font-headline font-extrabold text-2xl tracking-tighter text-primary">
                {firm}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-32 px-8">
        <div className="max-w-5xl mx-auto bg-primary rounded-[2rem] p-12 md:p-20 text-center relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-on-tertiary-container/10 rounded-full -mr-32 -mt-32 blur-3xl" />
          <div className="relative z-10">
            <h2 className="text-4xl md:text-5xl font-headline font-extrabold text-white mb-8">
              Ready to elevate your <br /> professional trajectory?
            </h2>
            <p className="text-on-tertiary-fixed-variant/80 text-lg mb-12 max-w-xl mx-auto">
              Join thousands of successful candidates who used our platform to secure their dream offers.
            </p>
            <button
              onClick={onOpenAuth}
              className="bg-on-tertiary-container text-primary px-10 py-5 rounded-full font-headline font-bold text-lg hover:bg-tertiary-fixed transition-all active:scale-95"
            >
              Start Free Trial
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
