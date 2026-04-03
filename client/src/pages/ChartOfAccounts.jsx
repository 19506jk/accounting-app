import { useState, useCallback } from 'react';
import { useAccounts, useCreateAccount, useUpdateAccount, useDeleteAccount } from '../api/useAccounts';
import { useLedgerReport } from '../api/useReports';
import { useToast }  from '../components/ui/Toast';
import Card    from '../components/ui/Card';
import Table   from '../components/ui/Table';
import Modal   from '../components/ui/Modal';
import Drawer  from '../components/ui/Drawer';
import Badge   from '../components/ui/Badge';
import Button  from '../components/ui/Button';
import Input   from '../components/ui/Input';
import Select  from '../components/ui/Select';
import DateRangePicker from '../components/ui/DateRangePicker';
import * as XLSX from 'xlsx';

const TYPE_OPTIONS = [
  { value: 'ASSET',     label: 'Asset' },
  { value: 'LIABILITY', label: 'Liability' },
  { value: 'EQUITY',    label: 'Equity' },
  { value: 'INCOME',    label: 'Income' },
  { value: 'EXPENSE',   label: 'Expense' },
];

const TYPE_ORDER = { ASSET: 1, LIABILITY: 2, EQUITY: 3, INCOME: 4, EXPENSE: 5 };
const TYPE_COLORS = {
  ASSET:     '#1d4ed8', LIABILITY: '#b91c1c',
  EQUITY:    '#7c3aed', INCOME:    '#15803d', EXPENSE:  '#c2410c',
};

function fmt(n) {
  return n === undefined || n === null ? '—'
    : '$' + Number(n).toLocaleString('en-CA', { minimumFractionDigits: 2 });
}

function currentMonth() {
  const n = new Date();
  return {
    from: new Date(n.getFullYear(), n.getMonth(), 1).toISOString().split('T')[0],
    to:   n.toISOString().split('T')[0],
  };
}

// ── Account Ledger Drawer ────────────────────────────────────────────────────
function AccountLedgerDrawer({ account, onClose }) {
  const [range, setRange] = useState(currentMonth());
  const [enabled, setEnabled] = useState(true);

  const { data, isLoading } = useLedgerReport(
    { from: range.from, to: range.to, account_id: account?.id },
    enabled && !!account
  );

  const ledger = data?.data?.ledger?.[0];

  function exportExcel() {
    if (!ledger) return;
    const rows = [
      [`${account.code} — ${account.name}`, '', '', '', ''],
      [`From: ${range.from}`, `To: ${range.to}`, '', '', ''],
      [],
      ['Date', 'Description', 'Fund', 'Debit', 'Credit', 'Balance'],
      [`Opening Balance`, '', '', '', '', ledger.opening_balance],
      ...ledger.rows.map((r) => [r.date, r.description, r.fund_name, r.debit || '', r.credit || '', r.balance]),
      [],
      ['Closing Balance', '', '', '', '', ledger.closing_balance],
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Ledger');
    XLSX.writeFile(wb, `ledger_${account.code}_${range.from}_${range.to}.xlsx`);
  }

  return (
    <Drawer isOpen={!!account} onClose={onClose} title={account ? `${account.code} — ${account.name}` : ''} width="600px">
      <div style={{ marginBottom: '1rem' }}>
        <DateRangePicker from={range.from} to={range.to}
          onChange={(r) => { setRange(r); setEnabled(true); }} />
      </div>

      {isLoading && <div style={{ color: '#6b7280', padding: '1rem' }}>Loading…</div>}

      {ledger && !isLoading && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between',
            alignItems: 'center', marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>
              Opening: <strong>{fmt(ledger.opening_balance)}</strong>
              &nbsp;→&nbsp;Closing: <strong>{fmt(ledger.closing_balance)}</strong>
            </div>
            <Button variant="secondary" size="sm" onClick={exportExcel}>Export Excel</Button>
          </div>

          <div style={{ overflowX: 'auto', fontSize: '0.8rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
                  {['Date','Description','Fund','Debit','Credit','Balance'].map((h) => (
                    <th key={h} style={{ padding: '0.5rem 0.75rem', textAlign: h === 'Description' || h === 'Fund' ? 'left' : 'right',
                      fontWeight: 600, color: '#6b7280', fontSize: '0.72rem',
                      textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ledger.rows.length === 0 ? (
                  <tr><td colSpan={6} style={{ padding: '1.5rem', textAlign: 'center',
                    color: '#9ca3af' }}>No entries in this date range.</td></tr>
                ) : ledger.rows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '0.45rem 0.75rem', whiteSpace: 'nowrap' }}>{r.date}</td>
                    <td style={{ padding: '0.45rem 0.75rem', maxWidth: '180px',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.description}
                    </td>
                    <td style={{ padding: '0.45rem 0.75rem', color: '#6b7280' }}>{r.fund_name}</td>
                    <td style={{ padding: '0.45rem 0.75rem', textAlign: 'right', color: '#15803d' }}>
                      {r.debit > 0 ? fmt(r.debit) : ''}
                    </td>
                    <td style={{ padding: '0.45rem 0.75rem', textAlign: 'right', color: '#b91c1c' }}>
                      {r.credit > 0 ? fmt(r.credit) : ''}
                    </td>
                    <td style={{ padding: '0.45rem 0.75rem', textAlign: 'right', fontWeight: 500 }}>
                      {fmt(r.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!ledger && !isLoading && (
        <div style={{ color: '#9ca3af', padding: '1rem', textAlign: 'center' }}>
          No entries found for this date range.
        </div>
      )}
    </Drawer>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
const EMPTY_FORM = { code: '', name: '', type: 'ASSET' };

export default function ChartOfAccounts() {
  const { addToast } = useToast();
  const [showInactive, setShowInactive] = useState(false);
  const { data: accounts, isLoading } = useAccounts({ include_inactive: showInactive });

  const createAccount = useCreateAccount();
  const updateAccount = useUpdateAccount();
  const deleteAccount = useDeleteAccount();

  const [modal,   setModal]   = useState(null); // null | 'add' | account
  const [form,    setForm]    = useState(EMPTY_FORM);
  const [errors,  setErrors]  = useState({});
  const [ledgerAccount, setLedgerAccount] = useState(null);

  const openAdd  = () => { setForm(EMPTY_FORM); setErrors({}); setModal('add'); };
  const openEdit = (a) => {
    setForm({ code: a.code, name: a.name, type: a.type });
    setErrors({});
    setModal(a);
  };

  function validate() {
    const e = {};
    if (!form.code.trim()) e.code = 'Code is required';
    if (!form.name.trim()) e.name = 'Name is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    try {
      if (modal === 'add') {
        await createAccount.mutateAsync(form);
        addToast('Account created.', 'success');
      } else {
        await updateAccount.mutateAsync({ id: modal.id, ...form });
        addToast('Account updated.', 'success');
      }
      setModal(null);
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed to save account.', 'error');
    }
  }

  async function handleDelete(account) {
    if (!account.is_deletable) return;
    if (!confirm(`Deactivate "${account.name}"?\n\nThis will hide the account from the chart. It can be restored manually if needed.`)) return;
    try {
      await deleteAccount.mutateAsync(account.id);
      addToast('Account deactivated.', 'success');
      setModal(null);
    } catch (err) {
      addToast(err.response?.data?.error || 'Cannot deactivate.', 'error');
    }
  }

  async function handleReactivate(account) {
    if (!confirm(`Reactivate "${account.name}"?`)) return;
    try {
      await updateAccount.mutateAsync({ id: account.id, is_active: true });
      addToast('Account reactivated.', 'success');
      setModal(null);
    } catch (err) {
      addToast(err.response?.data?.error || 'Cannot reactivate.', 'error');
    }
  }

  // Group by type
  const grouped = {};
  (accounts || []).forEach((a) => {
    if (!grouped[a.type]) grouped[a.type] = [];
    grouped[a.type].push(a);
  });
  const sortedTypes = Object.keys(grouped).sort(
    (a, b) => (TYPE_ORDER[a] || 9) - (TYPE_ORDER[b] || 9)
  );

  const isSaving = createAccount.isPending || updateAccount.isPending;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>
          Chart of Accounts
        </h1>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <Button variant="secondary" onClick={() => setShowInactive((v) => !v)}>
            {showInactive ? 'Hide Inactive' : 'Show Inactive'}
          </Button>
          <Button onClick={openAdd}>+ Add Account</Button>
        </div>
      </div>

      {isLoading ? (
        <Card><div style={{ padding: '2rem', color: '#9ca3af', textAlign: 'center' }}>Loading…</div></Card>
      ) : sortedTypes.map((type) => (
        <Card key={type} style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem',
            marginBottom: '0.75rem' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%',
              background: TYPE_COLORS[type], display: 'inline-block' }} />
            <span style={{ fontWeight: 700, fontSize: '0.8rem', color: TYPE_COLORS[type],
              textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {type}
            </span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <tbody>
              {grouped[type].map((a) => (
                <tr key={a.id}
                  style={{ borderBottom: '1px solid #f3f4f6', cursor: 'pointer',
                    opacity: a.is_active ? 1 : 0.45 }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#fafafa'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ padding: '0.6rem 0.75rem', width: '90px',
                    color: '#6b7280', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                    {a.code}
                  </td>
                  <td
                    style={{ padding: '0.6rem 0.75rem', color: '#1e293b',
                      fontWeight: 500, cursor: 'pointer' }}
                    onClick={() => setLedgerAccount(a)}
                  >
                    <span style={{ textDecoration: 'underline', textDecorationStyle: 'dotted',
                      textUnderlineOffset: '3px', textDecorationColor: '#cbd5e1' }}>
                      {a.name}
                    </span>
                  </td>
                  <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right' }}>
                    <Button variant="secondary" size="sm" onClick={() => openEdit(a)}>Edit</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}

      {/* Add / Edit Modal */}
      <Modal isOpen={!!modal} onClose={() => setModal(null)}
        title={modal === 'add' ? 'Add Account' : 'Edit Account'}>
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '1rem' }}>
            <Input label="Code" required value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              error={errors.code} placeholder="4001" />
            <Input label="Name" required value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              error={errors.name} placeholder="Regular Offering" />
          </div>
          <Select label="Type" required value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
            options={TYPE_OPTIONS} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
            {/* Left side — Deactivate / Reactivate */}
            {modal && modal !== 'add' && modal.is_active && (
              <Button
                variant="ghost"
                onClick={() => handleDelete(modal)}
                isLoading={deleteAccount.isPending}
                disabled={!modal.is_deletable}
                style={{ color: modal.is_deletable ? '#dc2626' : '#d1d5db' }}
              >
                {modal.is_deletable ? 'Deactivate Account' : 'Cannot Deactivate'}
              </Button>
            )}
            {modal && modal !== 'add' && !modal.is_active && (
              <Button
                variant="ghost"
                onClick={() => handleReactivate(modal)}
                isLoading={updateAccount.isPending}
                style={{ color: '#15803d' }}
              >
                Reactivate Account
              </Button>
            )}
            {modal === 'add' && <span />}
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
              <Button onClick={handleSave} isLoading={isSaving}>
                {modal === 'add' ? 'Add Account' : 'Save'}
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Ledger Drill-Down Drawer */}
      <AccountLedgerDrawer
        account={ledgerAccount}
        onClose={() => setLedgerAccount(null)}
      />
    </div>
  );
}
