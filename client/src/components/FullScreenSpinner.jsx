export default function FullScreenSpinner() {
  return (
    <div style={{
      position:       'fixed',
      inset:          0,
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      justifyContent: 'center',
      background:     '#f8fafc',
      gap:            '1rem',
      zIndex:         9999,
    }}>
      <div style={{
        width:        '2.5rem',
        height:       '2.5rem',
        border:       '3px solid #e2e8f0',
        borderTop:    '3px solid #3b82f6',
        borderRadius: '50%',
        animation:    'spin 0.8s linear infinite',
      }} />
      <p style={{ color: '#64748b', fontSize: '0.9rem', margin: 0 }}>
        Loading…
      </p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
