/**
 * SummaryBar — sticky footer showing live debit/credit totals and fund balance chips.
 * Used in Transaction form and Reconciliation workspace.
 */
export default function SummaryBar({ totalDebit, totalCredit, fundStatuses = [], style = {} }) {
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.001;

  return (
    <div style={{
      position:     'sticky',
      bottom:       0,
      background:   '#1e293b',
      color:        'white',
      padding:      '0.75rem 1.25rem',
      display:      'flex',
      alignItems:   'center',
      gap:          '1.5rem',
      flexWrap:     'wrap',
      borderTop:    '2px solid #334155',
      ...style,
    }}>
      <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.875rem' }}>
        <span>
          <span style={{ color: '#94a3b8' }}>Debits: </span>
          <span style={{ fontWeight: 600 }}>${totalDebit.toFixed(2)}</span>
        </span>
        <span>
          <span style={{ color: '#94a3b8' }}>Credits: </span>
          <span style={{ fontWeight: 600 }}>${totalCredit.toFixed(2)}</span>
        </span>
        <span>
          <span style={{ color: '#94a3b8' }}>Difference: </span>
          <span style={{
            fontWeight: 600,
            color: isBalanced ? '#4ade80' : '#f87171',
          }}>
            ${Math.abs(totalDebit - totalCredit).toFixed(2)}
          </span>
        </span>
      </div>

      {fundStatuses.length > 0 && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginLeft: 'auto' }}>
          {fundStatuses.map((f) => (
            <span key={f.name} style={{
              padding:      '0.2rem 0.65rem',
              borderRadius: '999px',
              fontSize:     '0.75rem',
              fontWeight:   600,
              background:   f.balanced ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)',
              color:        f.balanced ? '#4ade80' : '#f87171',
              border:       `1px solid ${f.balanced ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)'}`,
            }}>
              {f.balanced ? '✓' : '✗'} {f.name}
              {!f.balanced && ` ($${Math.abs(f.debit - f.credit).toFixed(2)} off)`}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
