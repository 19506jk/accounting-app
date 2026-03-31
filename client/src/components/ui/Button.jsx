const VARIANTS = {
  primary: {
    background: '#2563eb',
    color:      'white',
    border:     '1px solid #2563eb',
  },
  secondary: {
    background: 'white',
    color:      '#374151',
    border:     '1px solid #d1d5db',
  },
  danger: {
    background: '#dc2626',
    color:      'white',
    border:     '1px solid #dc2626',
  },
  ghost: {
    background: 'transparent',
    color:      '#6b7280',
    border:     '1px solid transparent',
  },
};

export default function Button({
  children,
  variant   = 'primary',
  isLoading = false,
  disabled  = false,
  size      = 'md',
  onClick,
  type      = 'button',
  style     = {},
}) {
  const v = VARIANTS[variant] || VARIANTS.primary;
  const isDisabled = disabled || isLoading;

  const padding = size === 'sm' ? '0.35rem 0.75rem' : '0.5rem 1.1rem';
  const fontSize = size === 'sm' ? '0.8rem' : '0.875rem';

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      style={{
        ...v,
        padding,
        fontSize,
        fontWeight:   500,
        borderRadius: '6px',
        cursor:       isDisabled ? 'not-allowed' : 'pointer',
        opacity:      isDisabled ? 0.65 : 1,
        display:      'inline-flex',
        alignItems:   'center',
        gap:          '0.4rem',
        transition:   'opacity 0.15s',
        whiteSpace:   'nowrap',
        ...style,
      }}
    >
      {isLoading && (
        <span style={{
          width:        '0.85em',
          height:       '0.85em',
          border:       '2px solid currentColor',
          borderTop:    '2px solid transparent',
          borderRadius: '50%',
          display:      'inline-block',
          animation:    'btn-spin 0.7s linear infinite',
          flexShrink:   0,
        }} />
      )}
      {children}
      <style>{`@keyframes btn-spin { to { transform: rotate(360deg); } }`}</style>
    </button>
  );
}
