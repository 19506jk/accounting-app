import type React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  style?: React.CSSProperties;
}

export default function Input({
  label,
  error,
  id,
  required,
  style = {},
  ...props
}: InputProps) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '_');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', ...style }}>
      {label && (
        <label
          htmlFor={inputId}
          style={{ fontSize: '0.8rem', fontWeight: 500, color: '#374151' }}
        >
          {label}
          {required && <span style={{ color: '#ef4444', marginLeft: '2px' }}>*</span>}
        </label>
      )}
      <input
        id={inputId}
        {...props}
        style={{
          padding:      '0.45rem 0.75rem',
          border:       `1px solid ${error ? '#fca5a5' : '#d1d5db'}`,
          borderRadius: '6px',
          fontSize:     '0.875rem',
          color:        '#111827',
          background:   props.disabled ? '#f9fafb' : 'white',
          outline:      'none',
          width:        '100%',
          boxSizing:    'border-box',
          transition:   'border-color 0.15s',
        }}
        onFocus={(e) => {
          e.target.style.borderColor = error ? '#f87171' : '#3b82f6';
          e.target.style.boxShadow   = error
            ? '0 0 0 2px #fecaca'
            : '0 0 0 2px #dbeafe';
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          e.target.style.borderColor = error ? '#fca5a5' : '#d1d5db';
          e.target.style.boxShadow   = 'none';
          props.onBlur?.(e);
        }}
      />
      {error && (
        <span style={{ fontSize: '0.75rem', color: '#dc2626' }}>{error}</span>
      )}
    </div>
  );
}
