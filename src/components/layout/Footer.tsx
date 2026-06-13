import React from 'react';

export default function Footer() {
  return (
    <footer className="bg-surface-container-low py-12">
      <div className="flex flex-col md:flex-row justify-between items-center px-8 w-full max-w-7xl mx-auto gap-4">
        <div className="font-body text-[10px] uppercase tracking-[0.05em] text-secondary">
          © 2026 The Case Owl. Confidential.
        </div>
        <div className="flex gap-8">
          <a href="#" className="font-body text-[10px] uppercase tracking-[0.05em] text-secondary hover:text-on-tertiary-container transition-colors">
            Privacy Policy
          </a>
          <a href="#" className="font-body text-[10px] uppercase tracking-[0.05em] text-secondary hover:text-on-tertiary-container transition-colors">
            Terms of Service
          </a>
          <a href="#" className="font-body text-[10px] uppercase tracking-[0.05em] text-secondary hover:text-on-tertiary-container transition-colors">
            Support
          </a>
        </div>
      </div>
    </footer>
  );
}
