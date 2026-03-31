/**
 * DateRangePicker — from/to inputs with quick preset buttons.
 */
function fmt(d) { return d.toISOString().split('T')[0]; }

const PRESETS = [
  {
    label: 'This Month',
    get() {
      const n = new Date();
      return { from: fmt(new Date(n.getFullYear(), n.getMonth(), 1)), to: fmt(n) };
    },
  },
  {
    label: 'Last Month',
    get() {
      const n = new Date();
      const s = new Date(n.getFullYear(), n.getMonth() - 1, 1);
      const e = new Date(n.getFullYear(), n.getMonth(), 0);
      return { from: fmt(s), to: fmt(e) };
    },
  },
  {
    label: 'This Year',
    get() {
      const n = new Date();
      return { from: fmt(new Date(n.getFullYear(), 0, 1)), to: fmt(n) };
    },
  },
  {
    label: 'Last Year',
    get() {
      const n = new Date();
      const y = n.getFullYear() - 1;
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    },
  },
];

export default function DateRangePicker({ from, to, onChange, style = {} }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem',
      flexWrap: 'wrap', ...style }}>
      {/* Presets */}
      {PRESETS.map((p) => (
        <button
          key={p.label}
          onClick={() => onChange(p.get())}
          style={{
            padding:      '0.35rem 0.7rem',
            border:       '1px solid #d1d5db',
            borderRadius: '6px',
            background:   'white',
            fontSize:     '0.78rem',
            cursor:       'pointer',
            color:        '#374151',
            whiteSpace:   'nowrap',
          }}
        >
          {p.label}
        </button>
      ))}

      <span style={{ color: '#d1d5db', margin: '0 0.25rem' }}>|</span>

      {/* Manual inputs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <input
          type="date"
          value={from || ''}
          onChange={(e) => onChange({ from: e.target.value, to })}
          style={{ padding: '0.35rem 0.5rem', border: '1px solid #d1d5db',
            borderRadius: '6px', fontSize: '0.8rem' }}
        />
        <span style={{ color: '#9ca3af', fontSize: '0.8rem' }}>to</span>
        <input
          type="date"
          value={to || ''}
          onChange={(e) => onChange({ from, to: e.target.value })}
          style={{ padding: '0.35rem 0.5rem', border: '1px solid #d1d5db',
            borderRadius: '6px', fontSize: '0.8rem' }}
        />
      </div>
    </div>
  );
}
