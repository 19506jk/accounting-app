import { useEffect, useRef } from 'react';
import type React from 'react';

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  width?: string | number;
}

export default function Drawer({ isOpen, onClose, title, children, width = '480px' }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // Trap focus inside drawer
  useEffect(() => {
    if (!isOpen) return;
    const selector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const getFocusable = () => Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(selector) || []
    ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1);
    getFocusable()[0]?.focus();

    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const elements = getFocusable();
      if (!elements.length) { e.preventDefault(); return; }
      const first = elements[0];
      const last  = elements[elements.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen]);

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position:   'fixed',
          inset:      0,
          background: 'rgba(0,0,0,0.3)',
          zIndex:     900,
          opacity:    isOpen ? 1 : 0,
          pointerEvents: isOpen ? 'auto' : 'none',
          transition: 'opacity 0.25s',
        }}
      />

      {/* Panel */}
      <div ref={panelRef} style={{
        position:   'fixed',
        top:        0,
        right:      0,
        bottom:     0,
        width,
        maxWidth:   '100vw',
        background: 'white',
        boxShadow:  '-8px 0 32px rgba(0,0,0,0.1)',
        zIndex:     901,
        display:    'flex',
        flexDirection: 'column',
        transform:  isOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
      }}>
        {/* Header */}
        <div style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          padding:        '1.25rem 1.5rem',
          borderBottom:   '1px solid #e5e7eb',
          flexShrink:     0,
        }}>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#1e293b' }}>
            {title}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border:     'none',
              fontSize:   '1.25rem',
              cursor:     'pointer',
              color:      '#9ca3af',
              lineHeight: 1,
              padding:    '0.2rem',
            }}
          >
            ×
          </button>
        </div>

        {/* Body — scrollable */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem' }}>
          {children}
        </div>
      </div>
    </>
  );
}
