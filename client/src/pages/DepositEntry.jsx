import { useState, useMemo, useEffect } from 'react';
import Decimal from 'decimal.js';
import { useCreateTransaction } from '../api/useTransactions';
import { useAccounts }  from '../api/useAccounts';
import { useFunds }     from '../api/useFunds';
import { useContacts }  from '../api/useContacts';
import { useToast }     from '../components/ui/Toast';
import Button      from '../components/ui/Button';
import Input       from '../components/ui/Input';
import Combobox    from '../components/ui/Combobox';
import { getChurchToday } from '../utils/date';

const dec = (v) => new Decimal(v || 0);
const fmt = (n) => '$' + Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2 });
const DONATION_GRID_TEMPLATE = 'minmax(220px, 1.8fr) minmax(170px, 1.3fr) minmax(200px, 1.3fr) minmax(240px, 1.8fr) 132px 40px';

const EMPTY_LINE = { contact_id: '', fund_id: '', account_id: '', amount: '', memo: '' };

export default function DepositEntry() {
  const { addToast }  = useToast();
  const { data: accounts  } = useAccounts();
  const { data: funds     } = useFunds();
  const { data: contacts  } = useContacts({ type: 'DONOR' });
  const createTx = useCreateTransaction();

  const today = getChurchToday();

  // -- Options & Derived Data --
  const assetAccounts = (accounts || []).filter(a => a.type === 'ASSET').map((a) => ({
    value: a.id, label: `${a.code} — ${a.name}`,
  }));
  
  const incomeAccounts = (accounts || []).filter(a => a.type === 'INCOME').map((a) => ({
    value: a.id, label: `${a.code} — ${a.name}`,
  }));

  const fundOptions = (funds || []).filter((f) => f.is_active).map((f) => ({
    value: f.id, label: f.name,
  }));

  const contactOptions = [
    { value: '', label: 'Anonymous / Loose Cash' },
    ...(contacts || []).map((c) => ({ value: c.id, label: c.donor_id ? `${c.donor_id} — ${c.name}` : c.name })),
  ];

  const defaultIncomeAccountId = incomeAccounts.length > 0 ? incomeAccounts[0].value : '';

  // -- State --
  const [header, setHeader] = useState({
    date: today,
    description: 'Sunday Offering',
    reference_no: '',
    total_amount: '',
    bank_account_id: ''
  });

  const [lines, setLines] = useState([{ ...EMPTY_LINE, account_id: defaultIncomeAccountId }]);
  const [errors, setErrors] = useState([]);

  // Auto-set default bank and income accounts once data loads
  useEffect(() => {
    if (assetAccounts.length > 0 && !header.bank_account_id) {
      setHeader(h => ({ ...h, bank_account_id: assetAccounts[0].value }));
    }
    if (defaultIncomeAccountId && lines[0].account_id === '') {
      setLine(0, 'account_id', defaultIncomeAccountId);
    }
    // 3. Auto-set first available Fund for the first line
    if (fundOptions.length > 0 && lines[0].fund_id === '') {
      const firstFundId = fundOptions[0].value;
      setLine(0, 'fund_id', firstFundId);
    }
  }, [assetAccounts, defaultIncomeAccountId]);

  // -- Handlers --
  function setLine(i, key, val) {
    setLines((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], [key]: val };
      return next;
    });
  }

  function addLine() { 
    // Inherit fund and account from the previous line for speed
    const prevLine = lines[lines.length - 1];
    setLines((prev) => [...prev, { 
      ...EMPTY_LINE, 
      fund_id: prevLine.fund_id || (fundOptions.length > 0 ? fundOptions[0].value : ''), 
      account_id: prevLine.account_id || defaultIncomeAccountId 
    }]); 
  }

  function removeLine(i) {
    if (lines.length <= 1) return;
    setLines((prev) => prev.filter((_, idx) => idx !== i));
  }

  // -- Calculations --
  const targetTotal = dec(header.total_amount || 0);
  const allocatedTotal = lines.reduce((sum, l) => sum.plus(dec(l.amount)), dec(0));
  const remaining = targetTotal.minus(allocatedTotal);
  const isBalanced = remaining.equals(0) && targetTotal.gt(0);

  function handleAllocateAnonymous() {
    if (remaining.lte(0)) return;
    const prevLine = lines[lines.length - 1];
    setLines((prev) => [...prev, {
      ...EMPTY_LINE,
      contact_id: '', // Anonymous
      fund_id: prevLine.fund_id || (fundOptions.length > 0 ? fundOptions[0].value : ''),
      account_id: prevLine.account_id || defaultIncomeAccountId,
      amount: remaining.toFixed(2)
    }]);
  }

  async function handleSubmit() {
    setErrors([]);
    
    // 1. Aggregate credits by fund to create balancing bank debits
    const fundTotals = {};
    lines.forEach(l => {
      if (!l.amount || !l.fund_id) return;
      const amt = parseFloat(l.amount);
      if (!fundTotals[l.fund_id]) fundTotals[l.fund_id] = 0;
      fundTotals[l.fund_id] += amt;
    });

    // 2. Map Bank Debits (One per fund involved)
    const debitEntries = Object.entries(fundTotals).map(([fundId, amount]) => {
      const linesForFund = lines.filter(l => String(l.fund_id) === String(fundId) && dec(l.amount).gt(0));
      const hasAnonymous = linesForFund.some((l) => !l.contact_id);
      const uniqueContacts = [...new Set(linesForFund.filter((l) => l.contact_id).map((l) => Number(l.contact_id)))];
      const contactId = !hasAnonymous && uniqueContacts.length === 1 ? uniqueContacts[0] : null;

      return {
        account_id: Number(header.bank_account_id),
        fund_id:    Number(fundId),
        debit:      amount,
        credit:     0,
        contact_id: contactId,
      };
    });

    // 3. Map Donor Credits
    const creditEntries = lines.filter(l => dec(l.amount).gt(0)).map(l => ({
      account_id: Number(l.account_id),
      fund_id:    Number(l.fund_id),
      debit:      0,
      credit:     parseFloat(l.amount),
      contact_id: l.contact_id ? Number(l.contact_id) : null,
      memo:       l.memo || undefined,
    }));

    const payload = {
      date:         header.date,
      description:  header.description,
      reference_no: header.reference_no || undefined,
      entries:      [...debitEntries, ...creditEntries],
    };

    try {
      await createTx.mutateAsync(payload);
      addToast('Deposit saved successfully.', 'success');
      // Reset form
      setHeader(h => ({ ...h, total_amount: '', reference_no: '' }));
      setLines([{ ...EMPTY_LINE, account_id: defaultIncomeAccountId }]);
    } catch (err) {
      const errs = err.response?.data?.errors || [err.response?.data?.error || 'Failed to save deposit.'];
      setErrors(errs);
    }
  }

  return (
    <div style={{ maxWidth: '1240px', margin: '0 auto', padding: '0 1rem 3rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>
          Make a Deposit
        </h1>
      </div>

      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
          <Input label="Date" required type="date" value={header.date}
            onChange={(e) => setHeader({ ...header, date: e.target.value })} />
          
          <Combobox label="Deposit To (Bank)" options={assetAccounts} value={header.bank_account_id}
            onChange={(v) => setHeader({ ...header, bank_account_id: v })} placeholder="Select bank..." />

          <Input label="Reference No" value={header.reference_no}
            onChange={(e) => setHeader({ ...header, reference_no: e.target.value })} placeholder="DEP-001" />

          <Input label="Total Deposit Amount" required type="number" min="0" step="0.01" value={header.total_amount}
            onChange={(e) => setHeader({ ...header, total_amount: e.target.value })}
            placeholder="0.00" style={{ fontSize: '1.1rem', fontWeight: 600, color: '#15803d' }} />
        </div>

        <Input label="Description" required value={header.description}
          onChange={(e) => setHeader({ ...header, description: e.target.value })}
          style={{ marginBottom: '2rem', maxWidth: '760px' }} />

        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', marginBottom: '0.75rem' }}>
          Donation Breakdown
        </div>

        <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', marginBottom: '1rem', overflowX: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: DONATION_GRID_TEMPLATE, minWidth: '1020px', gap: '0.75rem', padding: '0.5rem 0.75rem', background: '#f8fafc', borderBottom: '1px solid #e5e7eb', fontSize: '0.75rem', fontWeight: 600, color: '#6b7280' }}>
            <span>Donor</span><span>Fund</span><span>Income Account</span><span>Description</span><span style={{ textAlign: 'right' }}>Amount</span><span />
          </div>

          {lines.map((l, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: DONATION_GRID_TEMPLATE, minWidth: '1020px', gap: '0.75rem', padding: '0.5rem 0.75rem', borderBottom: i < lines.length - 1 ? '1px solid #f3f4f6' : 'none', alignItems: 'center' }}>
              <div>
                <Combobox options={contactOptions} value={l.contact_id}
                  onChange={(v) => setLine(i, 'contact_id', v)} placeholder="Anonymous / Cash" />
              </div>
              
              <div>
                <Combobox options={fundOptions} value={l.fund_id}
                  onChange={(v) => setLine(i, 'fund_id', v)} placeholder="Fund..." />
              </div>
              
              <div>
                <Combobox options={incomeAccounts} value={l.account_id}
                  onChange={(v) => setLine(i, 'account_id', v)} placeholder="Account..." />
              </div>

              <div style={{ paddingRight: '0.35rem' }}>
                <input type="text" value={l.memo}
                  onChange={(e) => setLine(i, 'memo', e.target.value)}
                  placeholder="Line description"
                  style={{ padding: '0.4rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.85rem', width: '100%' }} />
              </div>
              
              <div style={{ paddingLeft: '0.35rem' }}>
                <input type="number" min="0" step="0.01" value={l.amount}
                  onChange={(e) => setLine(i, 'amount', e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && i === lines.length - 1) addLine(); }}
                  placeholder="0.00"
                  style={{ padding: '0.4rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.85rem', textAlign: 'right', width: '100%' }} />
              </div>
              
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <button onClick={() => removeLine(i)} disabled={lines.length <= 1}
                  style={{ background: 'none', border: 'none', cursor: lines.length > 1 ? 'pointer' : 'not-allowed', color: lines.length > 1 ? '#ef4444' : '#e5e7eb', fontSize: '1.2rem', width: '28px', height: '28px', padding: 0, lineHeight: 1 }}>
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Button variant="secondary" size="sm" onClick={addLine}>+ Add Line</Button>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.9rem' }}>
            <span style={{ color: '#6b7280' }}>Allocated: <strong style={{ color: '#1e293b' }}>{fmt(allocatedTotal.toFixed(2))}</strong></span>
            <span style={{ color: remaining.equals(0) ? '#15803d' : '#b91c1c', fontWeight: 600 }}>
              Remaining: {fmt(remaining.toFixed(2))}
            </span>
            
            {remaining.gt(0) && (
              <Button variant="secondary" size="sm" onClick={handleAllocateAnonymous}>
                Allocate to Anonymous
              </Button>
            )}
          </div>
        </div>

        {errors.length > 0 && (
          <div style={{ marginTop: '1.5rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '0.75rem 1rem' }}>
            {errors.map((err, i) => <div key={i} style={{ fontSize: '0.85rem', color: '#dc2626' }}>• {err}</div>)}
          </div>
        )}

        <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end' }}>
          <Button onClick={handleSubmit} isLoading={createTx.isPending} disabled={!isBalanced}>
            Save Deposit
          </Button>
        </div>
      </div>
    </div>
  );
}
