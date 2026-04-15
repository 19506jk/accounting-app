// @ts-nocheck
import { useMemo, useState } from 'react';
import { useAccounts, useCreateAccount, useUpdateAccount, useDeleteAccount } from '../api/useAccounts';
import { useFunds, useCreateFund, useUpdateFund, useDeleteFund } from '../api/useFunds';
import { useLedgerReport } from '../api/useReports';
import { useToast }  from '../components/ui/Toast';
import Card    from '../components/ui/Card';
import Modal   from '../components/ui/Modal';
import Drawer  from '../components/ui/Drawer';
import Button  from '../components/ui/Button';
import Input   from '../components/ui/Input';
import Select  from '../components/ui/Select';
import DateRangePicker from '../components/ui/DateRangePicker';
import * as XLSX from 'xlsx';
import { currentMonthRange } from '../utils/date';

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
  return currentMonthRange();
}

// ── Account Ledger Drawer ────────────────────────────────────────────────────
function AccountLedgerDrawer({ target, onClose }) {
  const [range, setRange] = useState(currentMonth());
  const [enabled, setEnabled] = useState(true);
  const isFundMode = target?.mode === 'fund';
  const accountTarget = target?.mode === 'account' ? target : null;
  const fundTarget = target?.mode === 'fund' ? target : null;

  const { data, isLoading } = useLedgerReport(
    isFundMode
      ? { from: range.from, to: range.to, fund_id: fundTarget?.fundId }
      : { from: range.from, to: range.to, account_id: accountTarget?.accountId },
    enabled && !!target
  );

  const reportLedgers = data?.data?.ledger || [];
  const ledger = useMemo(() => {
    if (!isFundMode) return reportLedgers[0];

    const rows = reportLedgers
      .flatMap((acctLedger) =>
        acctLedger.rows.map((row) => ({
          ...row,
          account_code: acctLedger.account.code,
          description: `${acctLedger.account.code} — ${row.description}`,
        }))
      )
      .sort((a, b) => {
        if (a.date === b.date) return a.account_code.localeCompare(b.account_code);
        return a.date.localeCompare(b.date);
      });

    if (rows.length === 0) return null;
    return { opening_balance: null, closing_balance: null, rows };
  }, [isFundMode, reportLedgers]);

  const fundTotals = useMemo(() => {
    if (!isFundMode || !ledger?.rows?.length) return { debit: 0, credit: 0 };
    return ledger.rows.reduce((totals, row) => ({
      debit: totals.debit + Number(row.debit || 0),
      credit: totals.credit + Number(row.credit || 0),
    }), { debit: 0, credit: 0 });
  }, [isFundMode, ledger]);

  const drawerTitle = !target
    ? ''
    : isFundMode
      ? `Fund: ${fundTarget.fundName}${fundTarget.fundCode ? ` (${fundTarget.fundCode})` : ''}`
      : `${accountTarget.accountCode} — ${accountTarget.accountName}`;

  function exportExcel() {
    if (!ledger) return;
    const formatReferenceForExport = (referenceNo) => {
      if (referenceNo === null || referenceNo === undefined || referenceNo === '') return '-';
      return `'${String(referenceNo)}`;
    };

    const rows = [
      [drawerTitle, '', '', '', '', '', ''],
      [`From: ${range.from}`, `To: ${range.to}`, '', '', '', '', ''],
      [],
      ['Date', 'Reference No', 'Description', 'Fund', 'Debit', 'Credit', 'Balance'],
      ...(isFundMode ? [] : [[`Opening Balance`, '', '', '', '', '', ledger.opening_balance]]),
      ...ledger.rows.map((r) => [
        r.date,
        formatReferenceForExport(r.reference_no),
        r.description,
        r.fund_name,
        r.debit || '',
        r.credit || '',
        r.balance,
      ]),
      ...(isFundMode ? [] : [[], ['Closing Balance', '', '', '', '', '', ledger.closing_balance]]),
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [
      { wch: 12 },
      { wch: 18 },
      { wch: 28 },
      { wch: 18 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Ledger');
    const exportPrefix = isFundMode
      ? `fund_${fundTarget.fundCode || fundTarget.fundId}`
      : `account_${accountTarget.accountCode}`;
    XLSX.writeFile(wb, `ledger_${exportPrefix}_${range.from}_${range.to}.xlsx`);
  }

  return (
    <Drawer isOpen={!!target} onClose={onClose} title={drawerTitle} width="900px">
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
              {isFundMode ? (
                <>
                  Transactions: <strong>{ledger.rows.length}</strong>
                  &nbsp;•&nbsp;Debits: <strong>{fmt(fundTotals.debit)}</strong>
                  &nbsp;•&nbsp;Credits: <strong>{fmt(fundTotals.credit)}</strong>
                </>
              ) : (
                <>
                  Opening: <strong>{fmt(ledger.opening_balance)}</strong>
                  &nbsp;→&nbsp;Closing: <strong>{fmt(ledger.closing_balance)}</strong>
                </>
              )}
            </div>
            <Button variant="secondary" size="sm" onClick={exportExcel}>Export Excel</Button>
          </div>

          <div style={{ overflowX: 'auto', fontSize: '0.8rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
                  {['Date','Reference No','Description','Fund','Debit','Credit','Balance'].map((h) => (
                    <th key={h} style={{ padding: '0.5rem 0.75rem', textAlign: h === 'Description' || h === 'Fund' || h === 'Reference No' ? 'left' : 'right',
                      fontWeight: 600, color: '#6b7280', fontSize: '0.72rem',
                      textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ledger.rows.length === 0 ? (
                  <tr><td colSpan={7} style={{ padding: '1.5rem', textAlign: 'center',
                    color: '#9ca3af' }}>No entries in this date range.</td></tr>
                ) : ledger.rows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '0.45rem 0.75rem', whiteSpace: 'nowrap' }}>{r.date}</td>
                    <td
                      title={r.reference_no || '-'}
                      style={{ padding: '0.45rem 0.75rem', maxWidth: '160px',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {r.reference_no || '-'}
                    </td>
                    <td style={{ padding: '0.45rem 0.75rem', maxWidth: '260px',
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
  const { data: funds } = useFunds({ include_inactive: showInactive });

  const createAccount = useCreateAccount();
  const updateAccount = useUpdateAccount();
  const deleteAccount = useDeleteAccount();
  const createFund = useCreateFund();
  const updateFund = useUpdateFund();
  const deleteFund = useDeleteFund();

  const [modal,   setModal]   = useState(null); // null | 'add' | account
  const [form,    setForm]    = useState(EMPTY_FORM);
  const [errors,  setErrors]  = useState({});
  const [fundModal, setFundModal] = useState(null); // null | 'add' | fund
  const [fundForm, setFundForm] = useState({ name: '', code: '', description: '' });
  const [fundErrors, setFundErrors] = useState({});
  const [ledgerTarget, setLedgerTarget] = useState(null);

  const openAdd  = () => { setForm(EMPTY_FORM); setErrors({}); setModal('add'); };
  const openEdit = (a) => {
    setForm({ code: a.code, name: a.name, type: a.type });
    setErrors({});
    setModal(a);
  };
  const openAddFund = () => {
    setFundForm({ name: '', code: '', description: '' });
    setFundErrors({});
    setFundModal('add');
  };
  const openEditFund = (fund) => {
    setFundForm({
      name: fund.name,
      code: fund.net_asset_code || '',
      description: fund.description || '',
    });
    setFundErrors({});
    setFundModal(fund);
  };
  const setFund = (k) => (e) => setFundForm((f) => ({ ...f, [k]: e.target.value }));

  function validate() {
    const e = {};
    if (!form.code.trim()) e.code = 'Code is required';
    if (!form.name.trim()) e.name = 'Name is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function validateFund() {
    const e = {};
    if (!fundForm.name.trim()) e.name = 'Fund name is required';
    if (!fundForm.code.trim()) e.code = 'Fund code is required';
    setFundErrors(e);
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

  async function handleFundSave() {
    if (!validateFund()) return;
    try {
      if (fundModal === 'add') {
        const result = await createFund.mutateAsync(fundForm);
        addToast(`Fund created with equity account ${result.equityAccount?.code}.`, 'success');
      } else {
        await updateFund.mutateAsync({ id: fundModal.id, ...fundForm });
        addToast('Fund updated.', 'success');
      }
      setFundModal(null);
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed to save fund.', 'error');
    }
  }

  async function handleFundDeactivate() {
    if (!fundModal || fundModal === 'add') return;
    if (!confirm(`Deactivate "${fundModal.name}"? This will fail if the fund has a non-zero balance or transaction history.`)) return;
    try {
      await deleteFund.mutateAsync(fundModal.id);
      addToast('Fund deactivated.', 'success');
      setFundModal(null);
    } catch (err) {
      addToast(err.response?.data?.error || 'Cannot deactivate fund.', 'error');
    }
  }

  async function handleFundReactivate() {
    if (!fundModal || fundModal === 'add') return;
    if (!confirm(`Reactivate "${fundModal.name}"? Its linked net asset account will also be reactivated.`)) return;
    try {
      await updateFund.mutateAsync({ id: fundModal.id, is_active: true });
      addToast('Fund reactivated.', 'success');
      setFundModal(null);
    } catch (err) {
      addToast(err.response?.data?.error || 'Cannot reactivate fund.', 'error');
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
  const fundByAccountId = useMemo(() => {
    const map = {};
    (funds || []).forEach((fund) => {
      if (fund.net_asset_account_id) map[fund.net_asset_account_id] = fund;
    });
    return map;
  }, [funds]);
  const unlinkedFunds = useMemo(
    () => (funds || []).filter((fund) => !fund.net_asset_account_id),
    [funds]
  );

  const isSaving = createAccount.isPending || updateAccount.isPending;
  const isFundSaving = createFund.isPending || updateFund.isPending;
  const editingFund = fundModal && fundModal !== 'add' ? fundModal : null;

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
        <div key={type}>
          <Card style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem',
              marginBottom: '0.75rem' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%',
                background: TYPE_COLORS[type], display: 'inline-block' }} />
              <span style={{ fontWeight: 700, fontSize: '0.8rem', color: TYPE_COLORS[type],
                textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {type}
              </span>
              {type === 'EQUITY' && (
                <Button size="sm" onClick={openAddFund} style={{ marginLeft: 'auto' }}>
                  + Add Fund
                </Button>
              )}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <tbody>
                {grouped[type].map((a) => {
                  const fund = type === 'EQUITY' ? fundByAccountId[a.id] : undefined;
                  return (
                    <tr key={a.id}
                      style={{
                        borderBottom: '1px solid #f3f4f6',
                        cursor: 'pointer',
                        opacity: a.is_active ? 1 : 0.45,
                        background: fund ? '#faf5ff' : 'transparent',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#fafafa'}
                      onMouseLeave={(e) => e.currentTarget.style.background = fund ? '#faf5ff' : 'transparent'}
                    >
                      <td style={{ padding: '0.6rem 0.75rem', width: '90px',
                        color: '#6b7280', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                        {a.code}
                      </td>
                      <td
                        style={{ padding: '0.6rem 0.75rem', color: '#1e293b',
                          fontWeight: 500, cursor: 'pointer' }}
                        onClick={() => {
                          if (fund) {
                            setLedgerTarget({
                              mode: 'fund',
                              fundId: fund.id,
                              fundName: fund.name,
                              fundCode: fund.net_asset_code || '',
                              linkedAccountId: a.id,
                            });
                            return;
                          }
                          setLedgerTarget({
                            mode: 'account',
                            accountId: a.id,
                            accountCode: a.code,
                            accountName: a.name,
                          });
                        }}
                      >
                        <span style={{ textDecoration: 'underline', textDecorationStyle: 'dotted',
                          textUnderlineOffset: '3px', textDecorationColor: '#cbd5e1' }}>
                          {a.name}
                        </span>
                        {fund && (
                          <div style={{ fontSize: '0.72rem', color: '#7c3aed', marginTop: '2px' }}>
                            Fund: {fund.name}{fund.description ? ` — ${fund.description}` : ''}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right' }}>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => (fund ? openEditFund(fund) : openEdit(a))}
                        >
                          Edit
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          {type === 'EQUITY' && unlinkedFunds.length > 0 && (
            <Card style={{ marginBottom: '1rem', border: '1px solid #e9d5ff' }}>
              <div style={{ fontWeight: 700, fontSize: '0.8rem', color: '#7c3aed',
                textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>
                Funds Without Linked Equity Account
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ color: '#6b7280', textAlign: 'left' }}>
                    <th style={{ padding: '0.45rem 0.75rem', width: '90px', fontSize: '0.75rem', fontWeight: 600 }}>Code</th>
                    <th style={{ padding: '0.45rem 0.75rem', fontSize: '0.75rem', fontWeight: 600 }}>Fund</th>
                    <th style={{ padding: '0.45rem 0.75rem', textAlign: 'right', fontSize: '0.75rem', fontWeight: 600 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {unlinkedFunds.map((fund) => (
                    <tr
                      key={fund.id}
                      style={{ borderBottom: '1px solid #f3f4f6', opacity: fund.is_active ? 1 : 0.45 }}
                    >
                      <td style={{ padding: '0.6rem 0.75rem', width: '90px',
                        color: '#6b7280', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                        {fund.net_asset_code || '—'}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', color: '#1e293b', fontWeight: 500 }}>
                        {fund.name}
                        {fund.description && (
                          <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: '2px' }}>
                            {fund.description}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right' }}>
                        <Button variant="secondary" size="sm" onClick={() => openEditFund(fund)}>Edit</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
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

      <Modal isOpen={!!fundModal} onClose={() => setFundModal(null)}
        title={fundModal === 'add' ? 'Add Fund' : 'Edit Fund'}>
        <div style={{ display: 'grid', gap: '1rem' }}>
          <Input
            label="Fund Code"
            required
            value={fundForm.code}
            onChange={setFund('code')}
            error={fundErrors.code}
            placeholder="e.g., 3000"
          />
          <Input
            label="Fund Name"
            required
            value={fundForm.name}
            onChange={setFund('name')}
            error={fundErrors.name}
            placeholder="General Fund"
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 500, color: '#374151' }}>Description</label>
            <textarea
              value={fundForm.description}
              onChange={setFund('description')}
              rows={2}
              style={{
                padding: '0.45rem 0.75rem',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '0.875rem',
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />
          </div>
          {fundModal === 'add' && (
            <p style={{ fontSize: '0.78rem', color: '#6b7280', margin: 0 }}>
              An equity (net assets) account will be auto-created in the 3000–3899 range.
            </p>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
            {editingFund?.is_active && (
              <Button
                variant="ghost"
                onClick={handleFundDeactivate}
                isLoading={deleteFund.isPending}
                style={{ color: '#dc2626' }}
              >
                Deactivate Fund
              </Button>
            )}
            {editingFund && !editingFund.is_active && (
              <Button
                variant="ghost"
                onClick={handleFundReactivate}
                isLoading={updateFund.isPending}
                style={{ color: '#15803d' }}
              >
                Reactivate Fund
              </Button>
            )}
            {fundModal === 'add' && <span />}

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <Button variant="secondary" onClick={() => setFundModal(null)}>Cancel</Button>
              <Button onClick={handleFundSave} isLoading={isFundSaving}>
                {fundModal === 'add' ? 'Create Fund' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Ledger Drill-Down Drawer */}
      <AccountLedgerDrawer
        target={ledgerTarget}
        onClose={() => setLedgerTarget(null)}
      />
    </div>
  );
}
