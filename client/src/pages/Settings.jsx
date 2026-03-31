import { useState, useEffect }       from 'react';
import { useSettings, useUpdateSettings } from '../api/useSettings';
import { useToast }   from '../components/ui/Toast';
import Card    from '../components/ui/Card';
import Input   from '../components/ui/Input';
import Select  from '../components/ui/Select';
import Button  from '../components/ui/Button';

const PROVINCES = [
  'AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT',
].map((p) => ({ value: p, label: p }));

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
].map((m, i) => ({ value: String(i + 1), label: m }));

export default function Settings() {
  const { data: settings, isLoading } = useSettings();
  const update  = useUpdateSettings();
  const { addToast } = useToast();

  const [form, setForm] = useState({});

  // Populate form when settings load
  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  function handleChange(key) {
    return (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  async function handleSave() {
    try {
      await update.mutateAsync(form);
      addToast('Settings saved successfully.', 'success');
    } catch {
      addToast('Failed to save settings. Please try again.', 'error');
    }
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
      </Card>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button onClick={handleSave} isLoading={update.isPending}>
          Save Settings
        </Button>
      </div>
    </div>
  );
}
