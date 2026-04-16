import { useEffect, useRef } from 'react';
import type React from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  width?: string | number;
  className?: string;
  bodyClassName?: string;
  bodyStyle?: React.CSSProperties;
  adaptiveOnMobile?: boolean;
}

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  width = '480px',
  className = '',
  bodyClassName = '',
  bodyStyle = {},
  adaptiveOnMobile = false,
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement | null>(null);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // Trap focus inside modal
  useEffect(() => {
    if (!isOpen) return;
    const selector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const getFocusable = () => Array.from(
      modalRef.current?.querySelectorAll<HTMLElement>(selector) || []
    ).filter((element) => !element.hasAttribute('disabled') && element.tabIndex !== -1);
    const focusable = getFocusable();
    focusable[0]?.focus();

    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      const elements = getFocusable();
      if (!elements.length) {
        event.preventDefault();
        return;
      }

      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen]);

  // Prevent body scroll when open
  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      className={adaptiveOnMobile ? 'ui-modal-overlay ui-modal-overlay-adaptive' : 'ui-modal-overlay'}
      style={{
        position:       'fixed',
        inset:          0,
        background:     'rgba(0,0,0,0.4)',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        zIndex:         1000,
        padding:        '1rem',
      }}
    >
      <div
        ref={modalRef}
        onClick={(e: React.MouseEvent<HTMLDivElement>) => e.stopPropagation()}
        className={`ui-modal-panel ${adaptiveOnMobile ? 'ui-modal-panel-adaptive' : ''} ${className}`.trim()}
        style={{
          background:   'white',
          borderRadius: '12px',
          boxShadow:    '0 20px 60px rgba(0,0,0,0.15)',
          width:        '100%',
          maxWidth:     width,
          maxHeight:    '90vh',
          display:      'flex',
          flexDirection: 'column',
          overflow:     'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          padding:        '1.25rem 1.5rem',
          borderBottom:   '1px solid #e5e7eb',
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

        {/* Body */}
        <div className={bodyClassName} style={{ padding: '1.5rem', overflowY: 'auto', flex: 1, ...bodyStyle }}>
          {children}
        </div>
      </div>
    </div>
  );
}
