import { useState, useCallback, createContext, useContext } from 'react';
import type React from 'react';

export type ToastType = 'success' | 'error';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  addToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: ToastType = 'success') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}

      {/* Toast container — bottom right */}
      <div style={{
        position:      'fixed',
        bottom:        '1.5rem',
        right:         '1.5rem',
        display:       'flex',
        flexDirection: 'column',
        gap:           '0.5rem',
        zIndex:        2000,
      }}>
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              background:   t.type === 'error' ? '#fef2f2' : '#f0fdf4',
              border:       `1px solid ${t.type === 'error' ? '#fecaca' : '#bbf7d0'}`,
              borderLeft:   `4px solid ${t.type === 'error' ? '#dc2626' : '#16a34a'}`,
              color:        t.type === 'error' ? '#991b1b' : '#15803d',
              borderRadius: '8px',
              padding:      '0.75rem 1rem',
              fontSize:     '0.875rem',
              fontWeight:   500,
              boxShadow:    '0 4px 12px rgba(0,0,0,0.1)',
              display:      'flex',
              alignItems:   'center',
              gap:          '0.75rem',
              minWidth:     '280px',
              maxWidth:     '400px',
              animation:    'toast-in 0.25s ease',
            }}
          >
            <span style={{ flex: 1 }}>{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              style={{
                background: 'none',
                border:     'none',
                cursor:     'pointer',
                color:      'inherit',
                opacity:    0.6,
                fontSize:   '1rem',
                lineHeight: 1,
                padding:    0,
                flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <style>{`@keyframes toast-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </ToastContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
