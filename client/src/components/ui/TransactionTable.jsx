import { useEffect, useMemo, useState } from 'react';
import apiClient from '../../api/client';
import { formatDateOnlyForDisplay } from '../../utils/date';
import Button from './Button';
import Table from './Table';

export const TYPE_BADGE = {
  deposit:    { label: 'Deposit',    bg: '#dcfce7', color: '#15803d' },
  withdrawal: { label: 'Withdrawal', bg: '#fef2f2', color: '#b91c1c' },
  transfer:   { label: 'Transfer',   bg: '#f1f5f9', color: '#475569' },
};

const INACTIVE_BADGE = { label: 'Inactive', bg: '#f1f5f9', color: '#64748b' };

export function txFmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2 });
}

function TransactionDetail({ id, onEdit }) {
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    let isMounted = true;

    apiClient.get(`/transactions/${id}`).then(({ data }) => {
      if (!isMounted) return;
      setDetail(data.transaction);
    });

    return () => {
      isMounted = false;
    };
  }, [id]);

  if (!detail) return (
    <div style={{ padding: '0.75rem 1rem', background: '#f8fafc',
      fontSize: '0.8rem', color: '#6b7280' }}>
      Loading entries...
    </div>
  );

  return (
    <div style={{ padding: '0.75rem 1rem 1rem', background: '#f8fafc' }}>
      <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: '#6b7280' }}>
            <th style={{ textAlign: 'left',  padding: '0.25rem 0.5rem', fontWeight: 600 }}>Account</th>
            <th style={{ textAlign: 'left',  padding: '0.25rem 0.5rem', fontWeight: 600 }}>Fund</th>
            <th style={{ textAlign: 'left',  padding: '0.25rem 0.5rem', fontWeight: 600 }}>Contact</th>
            <th style={{ textAlign: 'left',  padding: '0.25rem 0.5rem', fontWeight: 600 }}>Description</th>
            <th style={{ textAlign: 'right', padding: '0.25rem 0.5rem', fontWeight: 600 }}>Debit</th>
            <th style={{ textAlign: 'right', padding: '0.25rem 0.5rem', fontWeight: 600 }}>Credit</th>
          </tr>
        </thead>
        <tbody>
          {detail.entries.map((e) => (
            <tr key={e.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
              <td style={{ padding: '0.3rem 0.5rem' }}>{e.account_code} {e.account_name}</td>
              <td style={{ padding: '0.3rem 0.5rem', color: '#6b7280' }}>{e.fund_name}</td>
              <td style={{ padding: '0.3rem 0.5rem', color: '#6b7280' }}>{e.contact_name || '—'}</td>
              <td style={{ padding: '0.3rem 0.5rem', color: '#6b7280' }}>{e.memo || '—'}</td>
              <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', color: '#15803d' }}>
                {e.debit  > 0 ? txFmt(e.debit)  : ''}
              </td>
              <td style={{ padding: '0.3rem 0.5rem', textAlign: 'right', color: '#b91c1c' }}>
                {e.credit > 0 ? txFmt(e.credit) : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {detail.is_voided && (
        <div style={{ marginTop: '0.75rem', fontSize: '0.78rem', color: '#64748b' }}>
          This transaction is inactive and cannot be edited.
        </div>
      )}

      {onEdit && !detail.is_voided && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
          <Button variant="secondary" size="sm" onClick={() => onEdit(detail)}>
            Edit
          </Button>
        </div>
      )}
    </div>
  );
}

export default function TransactionTable({
  columns,
  rows = [],
  isLoading = false,
  emptyText,
  skeletonRows = 4,
  onDelete,
  onEdit,
  expandedId,
  onExpandedChange,
}) {
  const baseColumns = useMemo(() => ([
    { key: 'date', label: 'Date',
      render: (r) => formatDateOnlyForDisplay(r.date) },
    { key: 'description', label: 'Description', wrap: true,
      render: (r) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span style={{ color: r.is_voided ? '#64748b' : '#1e293b' }}>{r.description}</span>
          {r.is_voided && (
            <span style={{ display: 'inline-block', padding: '0.15rem 0.5rem',
              borderRadius: '999px', fontSize: '0.72rem', fontWeight: 600,
              background: INACTIVE_BADGE.bg, color: INACTIVE_BADGE.color, whiteSpace: 'nowrap' }}>
              {INACTIVE_BADGE.label}
            </span>
          )}
        </div>
      ) },
    { key: 'transaction_type', label: 'Type',
      render: (r) => {
        const badge = TYPE_BADGE[r.transaction_type] || TYPE_BADGE.transfer;
        return (
          <span style={{ display: 'inline-block', padding: '0.15rem 0.5rem',
            borderRadius: '999px', fontSize: '0.72rem', fontWeight: 600,
            background: badge.bg, color: badge.color, whiteSpace: 'nowrap' }}>
            {badge.label}
          </span>
        );
      },
    },
    { key: 'contact_name', label: 'Donor / Payee',
      render: (r) => r.contact_name
        || (r.has_multiple_contacts
          ? <span style={{ color: '#6b7280' }}>Multiple</span>
          : <span style={{ color: '#d1d5db' }}>—</span>) },
    { key: 'reference_no', label: 'Ref',
      render: (r) => r.reference_no || <span style={{ color: '#d1d5db' }}>—</span> },
    { key: 'total_amount', label: 'Amount', align: 'right',
      render: (r) => (
        <span style={{ fontWeight: 500, color: r.is_voided ? '#64748b' : '#1e293b' }}>
          {txFmt(r.total_amount)}
        </span>
      ) },
  ]), []);

  const finalColumns = useMemo(() => {
    const selectedColumns = columns || baseColumns;
    if (!onDelete) return selectedColumns;

    return [
      ...selectedColumns,
      {
        key: 'actions',
        label: '',
        align: 'right',
        render: (row) => row.is_voided ? null : (
          <Button
            variant="ghost"
            size="sm"
            style={{ color: '#dc2626' }}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(e, row.id);
            }}
          >
            Delete
          </Button>
        ),
      },
    ];
  }, [baseColumns, columns, onDelete]);

  const isExpandable = typeof onExpandedChange === 'function' && expandedId !== undefined;

  return (
    <Table
      columns={finalColumns}
      rows={rows}
      isLoading={isLoading}
      emptyText={emptyText}
      skeletonRows={skeletonRows}
      onRowClick={isExpandable ? (row) => {
        const nextId = expandedId === row.id ? null : row.id;
        onExpandedChange(nextId);
      } : null}
      expandedId={isExpandable ? expandedId : null}
      renderExpanded={isExpandable ? (row) => (
        <TransactionDetail
          id={row.id}
          onEdit={onEdit}
        />
      ) : null}
    />
  );
}
