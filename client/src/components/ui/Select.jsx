export default function Select({
  label,
  error,
  id,
  required,
  options = [],
  placeholder,
  style = {},
  ...props
}) {
  const selectId = id || label?.toLowerCase().replace(/\s+/g, '_');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', ...(label && { gap: '0.3rem' }), ...style }}>
      {label && (
        <label
          htmlFor={selectId}
          style={{ fontSize: '0.8rem', fontWeight: 500, color: '#374151' }}
        >
          {label}
          {required && <span style={{ color: '#ef4444', marginLeft: '2px' }}>*</span>}
        </label>
      )}
      <select
        id={selectId}
        {...props}
        style={{
          padding:      '0.45rem 0.75rem',
          border:       `1px solid ${error ? '#fca5a5' : '#d1d5db'}`,
          borderRadius: '6px',
          fontSize:     '0.875rem',
          color:        '#111827',
          background:   'white',
          outline:      'none',
          width:        '100%',
          boxSizing:    'border-box',
          cursor:       'pointer',
          minHeight:    '36px',
        }}
      >
        {placeholder && (
          <option value="" disabled>{placeholder}</option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && (
        <span style={{ fontSize: '0.75rem', color: '#dc2626' }}>{error}</span>
      )}
    </div>
  );
}
