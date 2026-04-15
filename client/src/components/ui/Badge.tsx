const COLORS = {
  // Roles
  admin:   { bg: '#ede9fe', color: '#6d28d9' },
  editor:  { bg: '#dbeafe', color: '#1d4ed8' },
  viewer:  { bg: '#f3f4f6', color: '#4b5563' },
  // Status
  active:   { bg: '#dcfce7', color: '#15803d' },
  inactive: { bg: '#f3f4f6', color: '#9ca3af' },
  pending:  { bg: '#fef9c3', color: '#a16207' },
  // Contact type
  donor:  { bg: '#dbeafe', color: '#1d4ed8' },
  payee:  { bg: '#fce7f3', color: '#be185d' },
  both:   { bg: '#ede9fe', color: '#6d28d9' },
  // Generic
  success: { bg: '#dcfce7', color: '#15803d' },
  info:    { bg: '#dbeafe', color: '#1d4ed8' },
  warning: { bg: '#fef9c3', color: '#a16207' },
  error:   { bg: '#fee2e2', color: '#b91c1c' },
} as const;

interface BadgeProps {
  label?: string | number | null;
  variant?: string | null;
}

export default function Badge({ label, variant }: BadgeProps) {
  const key    = String(variant || label || '').toLowerCase();
  const colors = Object.prototype.hasOwnProperty.call(COLORS, key)
    ? COLORS[key as keyof typeof COLORS]
    : { bg: '#f3f4f6', color: '#4b5563' };

  return (
    <span style={{
      display:       'inline-block',
      padding:       '0.2rem 0.6rem',
      borderRadius:  '999px',
      fontSize:      '0.75rem',
      fontWeight:    600,
      textTransform: 'capitalize',
      background:    colors.bg,
      color:         colors.color,
      whiteSpace:    'nowrap',
    }}>
      {label}
    </span>
  );
}
