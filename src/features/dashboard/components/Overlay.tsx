import { useEffect, useRef, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/src/lib/utils';

interface OverlayProps {
  onClose: () => void;
  /** id of the element that titles the dialog (for screen readers). */
  labelledBy: string;
  variant?: 'dialog' | 'drawer';
  children: ReactNode;
}

/** Accessible modal/drawer shell: Esc and backdrop click close it, focus moves into it. */
export default function Overlay({ onClose, labelledBy, variant = 'dialog', children }: OverlayProps) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const drawer = variant === 'drawer';
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onClose}
      className={cn('fixed inset-0 z-[70] bg-primary/45 flex', drawer ? 'justify-end' : 'items-center justify-center p-4')}
    >
      <motion.div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        initial={drawer ? { x: 40, opacity: 0 } : { y: 12, opacity: 0 }}
        animate={drawer ? { x: 0, opacity: 1 } : { y: 0, opacity: 1 }}
        transition={{ duration: 0.18 }}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'bg-surface-container-lowest shadow-2xl focus:outline-none',
          drawer ? 'w-full max-w-md h-full overflow-y-auto p-6' : 'w-full max-w-[520px] rounded-2xl p-6 max-h-[90vh] overflow-y-auto',
        )}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
