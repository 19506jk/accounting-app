import { useState, useEffect, useMemo } from 'react';
import { useSettings, useUpdateSettings } from '../api/useSettings';
import { useTaxRates, useUpdateTaxRate, useToggleTaxRate } from '../api/useTaxRates';
import { useFiscalPeriods, useReopenFiscalPeriod } from '../api/useFiscalPeriods';
import { useAccounts } from '../api/useAccounts';
import { useToast }   from '../components/ui/Toast';
import Card    from '../components/ui/Card';
import Input   from '../components/ui/Input';
import Select  from '../components/ui/Select';
import Button  from '../components/ui/Button';
import Table   from '../components/ui/Table';
import Modal   from '../components/ui/Modal';
import Combobox from '../components/ui/Combobox';
import { DEFAULT_CHURCH_TIMEZONE, formatDateOnlyForDisplay } from '../utils/date';

const PROVINCES = [
  'AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT',
].map((p) => ({ value: p, label: p }));

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
].map((m, i) => ({ value: String(i + 1), label: m }));

const TIMEZONES = [
  'America/Toronto',
  'America/Vancouver',
  'America/Edmonton',
  'America/Winnipeg',
  'America/Halifax',
  'America/St_Johns',
  'UTC',
].map((zone) => ({ value: zone, label: zone }));

export default function Settings() {
  const { data: settings, isLoading } = useSettings();
  const update  = useUpdateSettings();
  const { addToast } = useToast();

  const { data: taxRates = [], isLoading: taxRatesLoading } = useTaxRates();
  const updateTaxRate = useUpdateTaxRate();
  const toggleTaxRate = useToggleTaxRate();
  const { data: fiscalPeriods = [], isLoading: periodsLoading } = useFiscalPeriods();
  const reopenPeriod = useReopenFiscalPeriod();

  const { data: accounts = [] } = useAccounts();
  const offsetAccountOptions = useMemo(() => [
    { value: '', label: 'None' },
    ...accounts
      .filter((a) => a.is_active && a.type !== 'ASSET')
      .map((a) => ({ value: String(a.id), label: `${a.code} — ${a.name}` })),
  ], [accounts]);

  // Per-row editing state: { [id]: '13.00' } — stored as display % string while editing
  const [editingRates, setEditingRates] = useState({});
  // Track which rows are currently saving
  const [savingRate, setSavingRate] = useState({});

  const [form, setForm] = useState({});
  const [confirmId, setConfirmId] = useState(null);
  const latestPeriodId = fiscalPeriods[0]?.id ?? null;

  // Populate form when settings load
  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  function handleChange(key) {
    return (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  function handleRateInputChange(id, value) {
    setEditingRates((prev) => ({ ...prev, [id]: value }));
  }

  async function handleRateSave(taxRate) {
    const displayVal = editingRates[taxRate.id];
    if (displayVal === undefined) return; // nothing changed

    const parsed = parseFloat(displayVal);
    if (isNaN(parsed) || parsed <= 0 || parsed >= 100) {
      addToast('Rate must be between 0 and 100 (e.g. 13 for 13%).', 'error');
      return;
    }

    setSavingRate((prev) => ({ ...prev, [taxRate.id]: true }));
    try {
      await updateTaxRate.mutateAsync({ id: taxRate.id, rate: parsed / 100 });
      setEditingRates((prev) => {
        const next = { ...prev };
        delete next[taxRate.id];
        return next;
      });
      addToast(`${taxRate.name} rate updated successfully.`, 'success');
    } catch {
      addToast(`Failed to update ${taxRate.name} rate. Please try again.`, 'error');
    } finally {
      setSavingRate((prev) => ({ ...prev, [taxRate.id]: false }));
    }
  }

  async function handleToggle(taxRate) {
    try {
      await toggleTaxRate.mutateAsync(taxRate.id);
      addToast(
        `${taxRate.name} ${taxRate.is_active ? 'deactivated' : 'activated'} successfully.`,
        'success',
      );
    } catch {
      addToast(`Failed to update ${taxRate.name} status. Please try again.`, 'error');
    }
  }

  async function handleSave() {
    try {
      await update.mutateAsync(form);
      addToast('Settings saved successfully.', 'success');
    } catch {
      addToast('Failed to save settings. Please try again.', 'error');
    }
  }

  async function handleReopen() {
    if (confirmId === null) return;
    try {
      await reopenPeriod.mutateAsync(confirmId);
      addToast('Period reopened.', 'success');
      setConfirmId(null);
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed to reopen period.', 'error');
    }
  }

  function formatDate(value) {
    return formatDateOnlyForDisplay(value) || '—';
  }

  if (isLoading) {
    return <div style={{ color: '#6b7280', padding: '2rem' }}>Loading settings…</div>;
  }

  return (
    <div style={{ maxWidth: '640px' }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.25rem' }}>
        Settings
      </h1>
      <p style={{ color: '#6b7280', fontSize: '0.875rem', marginBottom: '1.75rem' }}>
        Church profile — used on donation receipts and reports.
      </p>

      <Card style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ fontSize: '0.9rem', fontWeight: 600, color: '#374151',
          marginBottom: '1.25rem', marginTop: 0 }}>
          Church Profile
        </h2>
        <div style={{ display: 'grid', gap: '1rem' }}>
          <Input label="Church Name" required value={form.church_name || ''}
            onChange={handleChange('church_name')} />
          <Input label="Address Line 1" value={form.church_address_line1 || ''}
            onChange={handleChange('church_address_line1')} />
          <Input label="Address Line 2" value={form.church_address_line2 || ''}
            onChange={handleChange('church_address_line2')} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <Input label="City" value={form.church_city || ''}
              onChange={handleChange('church_city')} />
            <Select label="Province" value={form.church_province || ''}
              onChange={handleChange('church_province')}
              options={PROVINCES} placeholder="Select…" />
          </div>
          <Input label="Postal Code" value={form.church_postal_code || ''}
            onChange={handleChange('church_postal_code')}
            placeholder="A1A 1A1" style={{ maxWidth: '180px' }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <Input label="Phone" value={form.church_phone || ''}
              onChange={handleChange('church_phone')} />
            <Input label="Email" type="email" value={form.church_email || ''}
              onChange={handleChange('church_email')} />
          </div>
        </div>
      </Card>

      <Card style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ fontSize: '0.9rem', fontWeight: 600, color: '#374151',
          marginBottom: '1.25rem', marginTop: 0 }}>
          CRA Information
        </h2>
        <Input
          label="CRA Charitable Registration #"
          value={form.church_registration_no || ''}
          onChange={handleChange('church_registration_no')}
          placeholder="12345 6789 RR0001"
        />
        <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.5rem' }}>
          Required on official Canadian donation receipts.
        </p>
      </Card>

      <Card style={{ marginBottom: '1.75rem' }}>
        <h2 style={{ fontSize: '0.9rem', fontWeight: 600, color: '#374151',
          marginBottom: '1.25rem', marginTop: 0 }}>
          Fiscal Settings
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <Select
            label="Fiscal Year Start Month"
            value={form.fiscal_year_start || '1'}
            onChange={handleChange('fiscal_year_start')}
            options={MONTHS}
          />
          <Select
            label="Currency"
            value={form.currency || 'CAD'}
            onChange={handleChange('currency')}
            options={[{ value: 'CAD', label: 'CAD — Canadian Dollar' }]}
          />
        </div>
        <div style={{ marginTop: '1rem', maxWidth: '320px' }}>
          <Select
            label="Church Timezone"
            value={form.church_timezone || DEFAULT_CHURCH_TIMEZONE}
            onChange={handleChange('church_timezone')}
            options={TIMEZONES}
          />
        </div>
      </Card>

      <Card style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ fontSize: '0.9rem', fontWeight: 600, color: '#374151',
          marginBottom: '1.25rem', marginTop: 0 }}>
          Closed Fiscal Periods
        </h2>
        <Table
          columns={[
            { key: 'fiscal_year', label: 'Fiscal Year' },
            { key: 'period_start', label: 'Start', render: (p) => formatDate(p.period_start) },
            { key: 'period_end', label: 'End', render: (p) => formatDate(p.period_end) },
            { key: 'closed_at', label: 'Closed', render: (p) => formatDate(p.closed_at) },
            {
              key: 'actions',
              label: '',
              align: 'right',
              render: (p) => (
                p.id === latestPeriodId ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setConfirmId(p.id)}
                    disabled={reopenPeriod.isPending}
                  >
                    Reopen
                  </Button>
                ) : null
              ),
            },
          ]}
          rows={fiscalPeriods}
          isLoading={periodsLoading}
          emptyText="No closed fiscal periods."
        />
      </Card>

      <Card style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ fontSize: '0.9rem', fontWeight: 600, color: '#374151',
          marginBottom: '1.25rem', marginTop: 0 }}>
          Import Defaults
        </h2>
        <Combobox
          label="E-Transfer Deposit Offset Account"
          options={offsetAccountOptions}
          value={form.etransfer_deposit_offset_account_id ?? ''}
          onChange={(value) => setForm((f) => ({
            ...f,
            etransfer_deposit_offset_account_id: value === '' ? null : String(value),
          }))}
          placeholder="Select account…"
        />
        <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.5rem' }}>
          When set, e-transfer deposit rows are pre-filled with this offset account during CSV import.
        </p>
      </Card>

      <Card style={{ marginBottom: '1.75rem' }}>
        <h2 style={{ fontSize: '0.9rem', fontWeight: 600, color: '#374151',
          marginBottom: '0.25rem', marginTop: 0 }}>
          Tax Rates
        </h2>
        <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: '1.25rem' }}>
          Rates apply to bill entry. Deactivated rates will not appear in the tax dropdown.
        </p>

        {taxRatesLoading ? (
          <div style={{ color: '#6b7280', fontSize: '0.875rem' }}>Loading tax rates…</div>
        ) : (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {taxRates.map((tr) => {
              const isEditing  = editingRates[tr.id] !== undefined;
              const isSaving   = !!savingRate[tr.id];
              // Display value: use editing buffer if present, otherwise format stored rate as %
              const displayVal = isEditing
                ? editingRates[tr.id]
                : (tr.rate * 100).toFixed(2);

              return (
                <div
                  key={tr.id}
                  style={{
                    display:       'grid',
                    gridTemplateColumns: '80px 1fr 120px 90px',
                    alignItems:    'center',
                    gap:           '1rem',
                    padding:       '0.75rem 1rem',
                    borderRadius:  '0.5rem',
                    background:    tr.is_active ? '#f8fafc' : '#f1f5f9',
                    border:        '1px solid #e2e8f0',
                    opacity:       tr.is_active ? 1 : 0.6,
                  }}
                >
                  {/* Name */}
                  <span style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                    {tr.name}
                  </span>

                  {/* Rate input */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <input
                      type="number"
                      min="0"
                      max="99.9999"
                      step="0.01"
                      value={displayVal}
                      onChange={(e) => handleRateInputChange(tr.id, e.target.value)}
                      disabled={!tr.is_active || isSaving}
                      style={{
                        width:        '80px',
                        padding:      '0.375rem 0.5rem',
                        border:       '1px solid #d1d5db',
                        borderRadius: '0.375rem',
                        fontSize:     '0.875rem',
                        color:        '#1e293b',
                        background:   tr.is_active ? '#fff' : '#f1f5f9',
                        textAlign:    'right',
                      }}
                    />
                    <span style={{ color: '#6b7280', fontSize: '0.875rem' }}>%</span>
                  </div>

                  {/* Recoverable account */}
                  <span style={{ fontSize: '0.75rem', color: '#6b7280', whiteSpace: 'nowrap' }}>
                    → {tr.recoverable_account_name || '—'}
                  </span>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    {isEditing && (
                      <Button
                        size="sm"
                        onClick={() => handleRateSave(tr)}
                        isLoading={isSaving}
                        style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                      >
                        Save
                      </Button>
                    )}
                    <button
                      onClick={() => handleToggle(tr)}
                      disabled={toggleTaxRate.isPending}
                      style={{
                        padding:      '0.25rem 0.6rem',
                        fontSize:     '0.75rem',
                        borderRadius: '0.375rem',
                        border:       '1px solid #d1d5db',
                        background:   '#fff',
                        color:        tr.is_active ? '#ef4444' : '#10b981',
                        cursor:       'pointer',
                        fontWeight:   500,
                        whiteSpace:   'nowrap',
                      }}
                    >
                      {tr.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button onClick={handleSave} isLoading={update.isPending}>
          Save Settings
        </Button>
      </div>

      <Modal
        isOpen={confirmId !== null}
        onClose={() => setConfirmId(null)}
        title="Reopen Fiscal Period?"
      >
        <p style={{ margin: 0, color: '#374151', fontSize: '0.875rem', lineHeight: 1.5 }}>
          This will void the closing entry and unlock the period for new transactions.
          This cannot be undone without running Hard Close again.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
          <Button variant="ghost" onClick={() => setConfirmId(null)} disabled={reopenPeriod.isPending}>
            Cancel
          </Button>
          <Button variant="primary" isLoading={reopenPeriod.isPending} onClick={handleReopen}>
            Confirm Reopen
          </Button>
        </div>
      </Modal>
    </div>
  );
}
