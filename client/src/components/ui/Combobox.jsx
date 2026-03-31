import { useState, useRef, useEffect } from 'react';

/**
 * Combobox — searchable select for large lists (accounts, contacts).
 * Keyboard navigable. Shows placeholder when empty.
 */
export default function Combobox({
  label, options = [], value, onChange, placeholder = 'Search…',
  required, error, disabled, style = {},
}) {
  const [search,   setSearch]   = useState('');
  const [open,     setOpen]     = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef(null);
  const listRef  = useRef(null);

  const selected = options.find((o) => o.value === value);

  const filtered = search.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  useEffect(() => { if (!open) setSearch(''); }, [open]);

  function handleSelect(opt) {
    onChange(opt.value);
    setOpen(false);
    setSearch('');
  }

  function handleKeyDown(e) {
    if (!open) { if (e.key === 'Enter' || e.key === 'ArrowDown') setOpen(true); return; }
    if (e.key === 'ArrowDown')  setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    if (e.key === 'ArrowUp')    setHighlight((h) => Math.max(h - 1, 0));
    if (e.key === 'Enter')      { if (filtered[highlight]) handleSelect(filtered[highlight]); }
    if (e.key === 'Escape')     setOpen(false);
  }

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (!inputRef.current?.closest('[data-combobox]')?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div data-combobox style={{ position: 'relative', ...style }}>
      {label && (
        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500,
          color: '#374151', marginBottom: '0.3rem' }}>
          {label}{required && <span style={{ color: '#ef4444', marginLeft: 2 }}>*</span>}
        </label>
      )}
      <div
        onClick={() => { if (!disabled) { setOpen((o) => !o); setTimeout(() => inputRef.current?.focus(), 0); } }}
        style={{
          padding: '0.45rem 0.75rem', border: `1px solid ${error ? '#fca5a5' : '#d1d5db'}`,
          borderRadius: '6px', fontSize: '0.875rem', background: disabled ? '#f9fafb' : 'white',
          cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'space-between', minHeight: '36px',
        }}
      >
        {open ? (
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setHighlight(0); }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            style={{ border: 'none', outline: 'none', width: '100%',
              fontSize: '0.875rem', background: 'transparent' }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span style={{ color: selected ? '#111827' : '#9ca3af' }}>
            {selected ? selected.label : placeholder}
          </span>
        )}
        <span style={{ color: '#9ca3af', fontSize: '0.75rem', marginLeft: '0.5rem' }}>▾</span>
      </div>

      {open && (
        <div ref={listRef} style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000,
          background: 'white', border: '1px solid #e5e7eb', borderRadius: '6px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.1)', maxHeight: '220px',
          overflowY: 'auto', marginTop: '2px',
        }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '0.75rem 1rem', color: '#9ca3af', fontSize: '0.875rem' }}>
              No results found
            </div>
          ) : filtered.map((opt, i) => (
            <div
              key={opt.value}
              onMouseDown={() => handleSelect(opt)}
              style={{
                padding: '0.55rem 1rem', fontSize: '0.875rem', cursor: 'pointer',
                background: i === highlight ? '#eff6ff' : opt.value === value ? '#f0fdf4' : 'white',
                color: opt.value === value ? '#15803d' : '#111827',
              }}
              onMouseEnter={() => setHighlight(i)}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
      {error && <span style={{ fontSize: '0.75rem', color: '#dc2626' }}>{error}</span>}
    </div>
  );
}
