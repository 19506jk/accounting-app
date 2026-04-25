import { useMemo, useState } from 'react';
import { useBills, useVoidBill } from '../api/useBills';
import { useContacts } from '../api/useContacts';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/Toast';
import Card from '../components/ui/Card';
import Drawer from '../components/ui/Drawer';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';
import Select from '../components/ui/Select';
import Combobox from '../components/ui/Combobox';
import DateRangePicker from '../components/ui/DateRangePicker';
import { currentMonthRange, isDateOnlyBefore, getChurchToday } from '../utils/date';
import { getErrorMessage } from '../utils/errors';
import BillForm from './bills/BillForm';
import BillsTable from './bills/BillsTable';
import PaymentModal from './bills/PaymentModal';
import { fmt, getBillOutstanding, isBillVoided } from './bills/billHelpers';
import type { BillDetail, BillStatus, BillSummary } from '@shared/contracts';
import type { SelectOption } from '../components/ui/types';

type EditableBill = BillSummary | BillDetail;
type BillDrawerState =
  | { type: 'add' }
  | { type: 'edit'; bill: BillSummary }
  | { type: 'view'; bill: BillSummary }
  | null;
type VoidPromptState = { bill: EditableBill; closeDrawer: boolean } | null;

function currentMonth() {
  return currentMonthRange();
}

const statusOptions: SelectOption<BillStatus | ''>[] = [
  { value: '', label: 'All Statuses' },
  { value: 'UNPAID', label: 'Unpaid' },
  { value: 'PAID', label: 'Paid' },
  { value: 'VOID', label: 'Void' },
];

export default function Bills() {
  const { addToast } = useToast();
  const { user } = useAuth();
  const [range, setRange] = useState(currentMonth());
  const [statusFilter, setStatusFilter] = useState<BillStatus | ''>('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [showVoided, setShowVoided] = useState(false);
  const [drawer, setDrawer] = useState<BillDrawerState>(null);
  const [paymentBill, setPaymentBill] = useState<BillSummary | BillDetail | null>(null);
  const [voidPrompt, setVoidPrompt] = useState<VoidPromptState>(null);
  const [voidReason, setVoidReason] = useState('');

  const { data: bills, isLoading, refetch } = useBills({
    status: statusFilter || undefined,
    contact_id: vendorFilter || undefined,
    from: range.from,
    to: range.to,
    limit: 200,
  });

  const { data: contacts } = useContacts({ type: 'PAYEE' });
  const voidBill = useVoidBill();

  const vendorOptions = useMemo(() => [
    { value: '', label: 'All Vendors' },
    ...(contacts || []).map((contact) => ({ value: contact.id, label: contact.name })),
  ], [contacts]);

  const canEdit = user ? ['admin', 'editor'].includes(user.role) : false;
  const canVoid = user?.role === 'admin';
  const isAddDrawer = drawer?.type === 'add';
  const isViewDrawer = drawer?.type === 'view';
  const activeBill = drawer && drawer.type !== 'add' ? drawer.bill : null;

  const visibleBills = useMemo(() => {
    return (bills || []).filter((bill) => showVoided || !isBillVoided(bill));
  }, [bills, showVoided]);

  const summary = useMemo(() => {
    const unpaidBills = visibleBills.filter((bill) => bill.status === 'UNPAID');
    const totalUnpaid = unpaidBills.reduce((sum, bill) => sum + Math.max(getBillOutstanding(bill), 0), 0);
    const overdueBills = unpaidBills.filter((bill) => bill.due_date && isDateOnlyBefore(bill.due_date, getChurchToday()) && getBillOutstanding(bill) > 0);
    const totalOverdue = overdueBills.reduce((sum, bill) => sum + Math.max(getBillOutstanding(bill), 0), 0);
    return { totalUnpaid, totalOverdue, overdueCount: overdueBills.length };
  }, [visibleBills]);

  function handleAdd() {
    setDrawer({ type: 'add' });
  }

  function handleEdit(bill: BillSummary) {
    setDrawer({ type: 'edit', bill });
  }

  function handleView(bill: BillSummary) {
    setDrawer({ type: 'view', bill });
  }

  function handlePay(bill: BillSummary | BillDetail) {
    setPaymentBill(bill);
  }

  function handleVoid(bill: EditableBill, { closeDrawer = false }: { closeDrawer?: boolean } = {}) {
    setVoidPrompt({ bill, closeDrawer });
    setVoidReason('');
  }

  function closeVoidPrompt() {
    setVoidPrompt(null);
    setVoidReason('');
  }

  async function confirmVoid() {
    if (!voidPrompt) return;
    const reason_note = voidReason.trim();
    if (!reason_note) return;
    try {
      await voidBill.mutateAsync({ id: voidPrompt.bill.id, reason_note });
      addToast('Bill voided successfully.', 'success');
      if (voidPrompt.closeDrawer) setDrawer(null);
      closeVoidPrompt();
      refetch();
    } catch (err) {
      addToast(getErrorMessage(err, 'Cannot void bill.'), 'error');
    }
  }

  function handleRowClick(bill: BillSummary) {
    if (isBillVoided(bill)) return;
    if (bill.status === 'PAID') {
      handleView(bill);
      return;
    }
    if (bill.status === 'UNPAID') {
      handleEdit(bill);
    }
  }

  function handleDrawerSaved(savedBill: BillDetail, options?: { andPay?: boolean }) {
    setDrawer(null);
    refetch();
    if (options?.andPay) {
      setPaymentBill(savedBill);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>
          Bills
        </h1>
        {canEdit && (
          <Button onClick={handleAdd}>+ New Bill</Button>
        )}
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <DateRangePicker from={range.from} to={range.to} onChange={setRange} />

        <Select label="" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as BillStatus | '')}
          options={statusOptions} style={{ minWidth: '140px' }} />

        <Combobox label="" options={vendorOptions} value={vendorFilter}
          onChange={(value) => setVendorFilter(String(value))} placeholder="Filter by vendor…" style={{ minWidth: '140px' }} />

        <label style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.45rem',
          fontSize: '0.85rem',
          color: '#374151',
          fontWeight: 500,
          cursor: 'pointer',
          userSelect: 'none',
        }}>
          <input
            type="checkbox"
            checked={showVoided}
            onChange={(event) => setShowVoided(event.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          Show voided
        </label>
      </div>

      {(summary.totalUnpaid > 0 || summary.totalOverdue > 0) && (
        <div style={{ marginBottom: '1.25rem', display: 'flex', gap: '1rem' }}>
          {summary.totalUnpaid > 0 && (
            <div style={{ padding: '0.75rem 1.25rem', background: '#fef3c7', borderRadius: '8px', border: '1px solid #fcd34d' }}>
              <div style={{ fontSize: '0.75rem', color: '#92400e', fontWeight: 600 }}>Total Unpaid</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#92400e' }}>{fmt(summary.totalUnpaid)}</div>
            </div>
          )}
          {summary.totalOverdue > 0 && (
            <div style={{ padding: '0.75rem 1.25rem', background: '#fee2e2', borderRadius: '8px', border: '1px solid #fca5a5' }}>
              <div style={{ fontSize: '0.75rem', color: '#991b1b', fontWeight: 600 }}>Overdue</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#991b1b' }}>{fmt(summary.totalOverdue)} ({summary.overdueCount} bills)</div>
            </div>
          )}
        </div>
      )}

      <Card>
        <BillsTable
          bills={visibleBills}
          isLoading={isLoading}
          canEdit={canEdit}
          onPay={handlePay}
          onRowClick={handleRowClick}
        />
      </Card>

      <Drawer isOpen={!!drawer} onClose={() => setDrawer(null)}
        title={isAddDrawer ? 'New Bill' : isViewDrawer ? 'Bill Details' : 'Edit Bill'} width="850px">
        {activeBill && (
          <BillForm
            bill={activeBill}
            onClose={() => setDrawer(null)}
            onSaved={handleDrawerSaved}
            onVoid={(bill) => handleVoid(bill, { closeDrawer: true })}
            canVoid={canVoid}
            isVoiding={voidBill.isPending}
            readOnly={isViewDrawer}
          />
        )}
        {isAddDrawer && (
          <BillForm onClose={() => setDrawer(null)} onSaved={handleDrawerSaved} />
        )}
      </Drawer>

      <PaymentModal
        bill={paymentBill}
        isOpen={!!paymentBill}
        onClose={() => setPaymentBill(null)}
        onPaid={() => { refetch(); }}
      />

      <Modal
        isOpen={!!voidPrompt}
        onClose={closeVoidPrompt}
        title="Void Bill?"
      >
        <p style={{ margin: 0, color: '#374151', fontSize: '0.875rem', lineHeight: 1.5 }}>
          This action cannot be undone and will be recorded in the audit history.
        </p>
        <div style={{ marginTop: '0.75rem', color: '#374151', fontSize: '0.875rem' }}>
          <div>Vendor: {voidPrompt?.bill.vendor_name || '—'}</div>
          <div>Amount: {voidPrompt ? fmt(voidPrompt.bill.amount) : '—'}</div>
          <div>Bill #: {voidPrompt?.bill.bill_number || '—'}</div>
        </div>
        <div style={{ marginTop: '1rem' }}>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem', color: '#374151' }}>
            Reason for voiding
          </label>
          <textarea
            value={voidReason}
            onChange={(event) => setVoidReason(event.target.value)}
            rows={3}
            style={{
              width: '100%',
              border: '1px solid #d1d5db',
              borderRadius: '0.5rem',
              padding: '0.6rem 0.75rem',
              fontSize: '0.875rem',
              resize: 'vertical',
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
          <Button variant="ghost" onClick={closeVoidPrompt} disabled={voidBill.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            isLoading={voidBill.isPending}
            onClick={confirmVoid}
            disabled={!voidReason.trim()}
          >
            Confirm Void
          </Button>
        </div>
      </Modal>
    </div>
  );
}
