export default function Card({ children, style = {} }) {
  return (
    <div style={{
      background:   'white',
      border:       '1px solid #e5e7eb',
      borderRadius: '10px',
      padding:      '1.25rem 1.5rem',
      boxShadow:    '0 1px 4px rgba(0,0,0,0.04)',
      ...style,
    }}>
      {children}
    </div>
  );
}
