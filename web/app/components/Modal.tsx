// Modal — generic overlay primitive. There's no shared .modal class in
// style.css: every legacy modal (tournament.html's #scoreModal,
// #charPickerModal, #endTournamentModal) is bespoke markup + page-local
// <style>. This is deliberately unopinionated -- backdrop + centered panel
// only -- so Phase 2 pages build their own modal *content* inside it rather
// than this component guessing at page-specific layout it hasn't seen yet.
'use client';

import { useEffect, type ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: number;
}

export default function Modal({ open, onClose, children, maxWidth = 480 }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 300,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        className="glass"
        style={{
          maxWidth,
          width: '90%',
          borderRadius: 'var(--radius)',
          padding: 'var(--space-6)',
          boxShadow: 'var(--shadow-modal)',
        }}
      >
        {children}
      </div>
    </div>
  );
}
