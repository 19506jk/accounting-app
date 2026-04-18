import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useReconciliations, useReconciliation,
  useCreateReconciliation,
  useClearItem, useCloseReconciliation, useDeleteReconciliation, getReconciliationReport,
} from '../api/useReconciliation';
import { useAccounts }  from '../api/useAccounts';
import { useToast }     from '../components/ui/Toast';
import Card    from '../components/ui/Card';
import Table   from '../components/ui/Table';
import Modal   from '../components/ui/Modal';
import Badge   from '../components/ui/Badge';
import Button  from '../components/ui/Button';
import Input   from '../components/ui/Input';
import Select  from '../components/ui/Select';
import { formatDateOnlyForDisplay } from '../utils/date';
import { getErrorMessage } from '../utils/errors';
import { exportReconciliationReport } from './reports/reportExports';
import type React from 'react';
import type { ReconciliationSummary } from '@shared/contracts';
import type { TableColumn } from '../components/ui/types';

const fmt = (n: number | null | undefined) => '$' + Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2 });

interface WorkspaceProps {
  id: number;
  onBack: () => void;
  onExport: (id: number) => Promise<void>;
  isExporting: boolean;
}

interface ReconciliationForm {
  account_id: string;
  statement_date: string;
  statement_balance: string;
  opening_balance: string;
}

// ── Reconciliation Workspace ─────────────────────────────────────────────────
function Workspace({ id, onBack, onExport, isExporting }: WorkspaceProps) {
  const { addToast }  = useToast();
  const { data: recon, isLoading } = useReconciliation(id);
  const clearItem   = useClearItem(id);
  const closeRecon  = useCloseReconciliation();

  if (isLoading) return <div style={{ padding: '2rem', color: '#6b7280' }}>Loading…</div>;
  if (!recon)    return null;

  const items    = recon.items || [];
  const cleared  = items.filter((i) => i.is_cleared);
  const uncleared = items.filter((i) => !i.is_cleared);

  function selectAll(val: boolean) {
    items.forEach((item) => {
      if (item.is_cleared !== val) clearItem.mutate({ itemId: item.id });
    });
  }

  function selectByType(isDebit: boolean) {
    items.forEach((item) => {
      const isItemDebit = item.debit > 0;
      if (isItemDebit === isDebit && !item.is_cleared) clearItem.mutate({ itemId: item.id });
    });
  }

  async function handleClose() {
    if (!recon) return;
    if (recon.difference !== 0) return;
    if (!confirm('Close this reconciliation? This cannot be undone.')) return;
    try {
      await closeRecon.mutateAsync(id);
      addToast('Reconciliation closed successfully.', 'success');
      onBack();
    } catch (err) {
      addToast(getErrorMessage(err, 'Failed to close.'), 'error');
    }
  }

  const isBalanced = Math.abs(recon.difference) < 0.001;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ padding: '1.5rem', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none',
            cursor: 'pointer', color: '#6b7280', fontSize: '0.875rem' }}>
            ← Back
          </button>
          <h1 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: '#1e293b' }}>
            {recon.account_name} — {recon.statement_date}
          </h1>
          <Badge label={recon.is_closed ? 'Closed' : recon.status}
            variant={recon.is_closed ? 'inactive' : isBalanced ? 'success' : 'error'} />
          <div style={{ marginLeft: 'auto' }}>
            <Button variant="secondary" size="sm" onClick={() => onExport(id)} isLoading={isExporting}>
              Export Report
            </Button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, auto)', gap: '1.5rem',
          fontSize: '0.875rem' }}>
          <div>
            <div style={{ color: '#6b7280', fontSize: '0.75rem', marginBottom: '0.2rem' }}>Statement Balance</div>
            <div style={{ fontWeight: 600 }}>{fmt(recon.statement_balance)}</div>
          </div>
          <div>
            <div style={{ color: '#6b7280', fontSize: '0.75rem', marginBottom: '0.2rem' }}>Opening Balance</div>
            <div style={{ fontWeight: 600 }}>{fmt(recon.opening_balance)}</div>
          </div>
          <div>
            <div style={{ color: '#6b7280', fontSize: '0.75rem', marginBottom: '0.2rem' }}>Cleared Balance</div>
            <div style={{ fontWeight: 600 }}>{fmt(recon.cleared_balance)}</div>
          </div>
          <div>
            <div style={{ color: '#6b7280', fontSize: '0.75rem', marginBottom: '0.2rem' }}>Difference</div>
            <div style={{ fontWeight: 700, color: isBalanced ? '#15803d' : '#dc2626' }}>
              {fmt(recon.difference)}
            </div>
          </div>
        </div>
      </div>

      {/* Batch controls */}
      {!recon.is_closed && (
        <div style={{ padding: '0.75rem 1.5rem', borderBottom: '1px solid #e5e7eb',
          display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Button variant="secondary" size="sm" onClick={() => selectAll(true)}>☑ Select All</Button>
          <Button variant="secondary" size="sm" onClick={() => selectAll(false)}>☐ Deselect All</Button>
          <Button variant="secondary" size="sm" onClick={() => selectByType(true)}>☑ Select Deposits</Button>
          <Button variant="secondary" size="sm" onClick={() => selectByType(false)}>☑ Select Payments</Button>
        </div>
      )}

      {/* Items table */}
      <div style={{ flex: 1, padding: '1.5rem', overflowY: 'auto' }}>
        <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.5rem' }}>
          {cleared.length} of {items.length} items cleared
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
              <th style={{ width: 32, padding: '0.6rem 0.75rem' }} />
              <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem', fontWeight: 600,
                color: '#6b7280', fontSize: '0.75rem', textTransform: 'uppercase' }}>Date</th>
              <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem', fontWeight: 600,
                color: '#6b7280', fontSize: '0.75rem', textTransform: 'uppercase' }}>Description</th>
              <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem', fontWeight: 600,
                color: '#6b7280', fontSize: '0.75rem', textTransform: 'uppercase' }}>Fund</th>
              <th style={{ textAlign: 'right', padding: '0.6rem 0.75rem', fontWeight: 600,
                color: '#6b7280', fontSize: '0.75rem', textTransform: 'uppercase' }}>Deposit</th>
              <th style={{ textAlign: 'right', padding: '0.6rem 0.75rem', fontWeight: 600,
                color: '#6b7280', fontSize: '0.75rem', textTransform: 'uppercase' }}>Payment</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}
                onClick={() => !recon.is_closed && clearItem.mutate({ itemId: item.id })}
                style={{
                  borderBottom: '1px solid #f3f4f6',
                  cursor:       recon.is_closed ? 'default' : 'pointer',
                  background:   item.is_cleared ? '#f0fdf4' : 'transparent',
                  transition:   'background 0.1s',
                }}
                onMouseEnter={(e) => {
                  if (!recon.is_closed) e.currentTarget.style.background = item.is_cleared ? '#dcfce7' : '#fafafa';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = item.is_cleared ? '#f0fdf4' : 'transparent';
                }}
              >
                <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>
                  <input type="checkbox" checked={item.is_cleared}
                    onChange={() => {}} readOnly style={{ cursor: 'pointer' }} />
                </td>
                <td style={{ padding: '0.6rem 0.75rem', whiteSpace: 'nowrap', color: '#6b7280' }}>
                  {formatDateOnlyForDisplay(item.date)}
                </td>
                <td style={{ padding: '0.6rem 0.75rem' }}>{item.description}</td>
                <td style={{ padding: '0.6rem 0.75rem', color: '#6b7280' }}>{item.fund_name}</td>
                <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right', color: '#15803d', fontWeight: 500 }}>
                  {item.debit > 0 ? fmt(item.debit) : ''}
                </td>
                <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right', color: '#b91c1c', fontWeight: 500 }}>
                  {item.credit > 0 ? fmt(item.credit) : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      {!recon.is_closed && (
        <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid #e5e7eb',
          display: 'flex', justifyContent: 'flex-end' }}>
          <Button onClick={handleClose} disabled={!isBalanced}
            isLoading={closeRecon.isPending}>
            {isBalanced ? 'Close Reconciliation' : `Difference: ${fmt(recon.difference)}`}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Reconciliation List ──────────────────────────────────────────────────────
export default function Reconciliation() {
  const { addToast } = useToast();
  const queryClient = useQueryClient()
  const { data: reconciliations, isLoading } = useReconciliations();
  const { data: accounts } = useAccounts();
  const createRecon  = useCreateReconciliation();
  const deleteRecon  = useDeleteReconciliation();

  const [activeId, setActiveId]   = useState<number | null>(null);
  const [exportingId, setExportingId] = useState<number | null>(null);
  const [showNew,  setShowNew]    = useState(false);
  const [form,     setForm]       = useState<ReconciliationForm>({
    account_id: '', statement_date: '', statement_balance: '', opening_balance: '0',
  });

  async function handleExport(id: number) {
    try {
      setExportingId(id)
      const report = await getReconciliationReport(queryClient, id)
      exportReconciliationReport(report)
    } catch (err) {
      addToast(getErrorMessage(err, 'Failed to export report.'), 'error')
    } finally {
      setExportingId(null)
    }
  }

  if (activeId) {
    return (
      <Workspace
        id={activeId}
        onBack={() => setActiveId(null)}
        onExport={handleExport}
        isExporting={exportingId === activeId}
      />
    )
  }

  const assetAccounts = (accounts || [])
    .filter((a) => ['ASSET', 'LIABILITY'].includes(a.type))
    .map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` }));

  const set = (k: keyof ReconciliationForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };

  async function handleCreate() {
    try {
      const result = await createRecon.mutateAsync({
        account_id:        Number(form.account_id),
        statement_date:    form.statement_date,
        statement_balance: parseFloat(form.statement_balance),
        opening_balance:   parseFloat(form.opening_balance || '0'),
      });
      addToast(`Reconciliation created — ${result.items_loaded} items loaded.`, 'success');
      setShowNew(false);
      setActiveId(result.reconciliation.id);
    } catch (err) {
      addToast(getErrorMessage(err, 'Failed to create.'), 'error');
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this reconciliation?')) return;
    try {
      await deleteRecon.mutateAsync(id);
      addToast('Reconciliation deleted.', 'success');
    } catch (err) {
      addToast(getErrorMessage(err, 'Cannot delete.'), 'error');
    }
  }

  const COLUMNS: TableColumn<ReconciliationSummary>[] = [
    { key: 'account_name', label: 'Account',
      render: (r) => `${r.account_code} — ${r.account_name}` },
    { key: 'statement_date', label: 'Statement Date' },
    { key: 'statement_balance', label: 'Statement Balance', align: 'right',
      render: (r) => fmt(r.statement_balance) },
    { key: 'status', label: 'Status',
      render: (r) => <Badge label={r.is_closed ? 'Closed' : 'Open'}
        variant={r.is_closed ? 'inactive' : 'pending'} /> },
    { key: 'actions', label: '', align: 'right',
      render: (r) => (
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <Button variant="secondary" size="sm" onClick={() => setActiveId(r.id)}>
            {r.is_closed ? 'View' : 'Continue'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => handleExport(r.id)}
            isLoading={exportingId === r.id}
          >
            Export Report
          </Button>
          {!r.is_closed && (
            <Button variant="ghost" size="sm" style={{ color: '#dc2626' }}
              onClick={() => handleDelete(r.id)}>Delete</Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>
          Reconciliation
        </h1>
        <Button onClick={() => setShowNew(true)}>+ New Reconciliation</Button>
      </div>

      <Card>
        <Table columns={COLUMNS} rows={reconciliations || []} isLoading={isLoading}
          emptyText="No reconciliations yet." />
      </Card>

      <Modal isOpen={showNew} onClose={() => setShowNew(false)} title="New Reconciliation">
        <div style={{ display: 'grid', gap: '1rem' }}>
          <Select label="Bank Account" required value={form.account_id}
            onChange={set('account_id')} options={assetAccounts} placeholder="Select account…" />
          <Input label="Statement Date" required type="date" value={form.statement_date}
            onChange={set('statement_date')} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <Input label="Opening Balance" required type="number" step="0.01"
              value={form.opening_balance} onChange={set('opening_balance')}
              placeholder="0.00" />
            <Input label="Statement Closing Balance" required type="number" step="0.01"
              value={form.statement_balance} onChange={set('statement_balance')}
              placeholder="0.00" />
          </div>
          <p style={{ fontSize: '0.78rem', color: '#6b7280', margin: 0 }}>
            All unreconciled entries for this account up to the statement date will be loaded automatically.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
            <Button variant="secondary" onClick={() => setShowNew(false)}>Cancel</Button>
            <Button onClick={handleCreate} isLoading={createRecon.isPending}>Start Reconciliation</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
