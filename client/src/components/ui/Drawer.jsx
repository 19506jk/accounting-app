import { useEffect } from 'react';

export default function Drawer({ isOpen, onClose, title, children, width = '480px' }) {
  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

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
          pointerEvents: isOpen ? 'all' : 'none',
          transition: 'opacity 0.25s',
        }}
      />

      {/* Panel */}
      <div style={{
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
