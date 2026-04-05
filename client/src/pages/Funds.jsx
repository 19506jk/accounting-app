import { useState } from 'react';
import { useFunds, useCreateFund, useUpdateFund, useDeleteFund } from '../api/useFunds';
import { useToast }  from '../components/ui/Toast';
import Card   from '../components/ui/Card';
import Table  from '../components/ui/Table';
import Modal  from '../components/ui/Modal';
import Badge  from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Input  from '../components/ui/Input';

export default function Funds() {
  const { addToast } = useToast();
  const [showInactive, setShowInactive] = useState(false);

  const { data: funds, isLoading } = useFunds({ include_inactive: showInactive });
  const visibleFunds = showInactive ? (funds || []) : (funds?.filter(f => f.is_active) || []);

  const createFund = useCreateFund();
  const updateFund = useUpdateFund();
  const deleteFund = useDeleteFund();

  const [modal,  setModal]  = useState(null);
  const [form,   setForm]   = useState({ name: '', description: '', code: '' });
  const [errors, setErrors] = useState({});

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function openAdd() { setForm({ name: '', description: '', code: '' }); setErrors({}); setModal('add'); }
  function openEdit(f) {
    setForm({ name: f.name, description: f.description || '', code: f.net_asset_code || '' });
    setErrors({});
    setModal(f);
  }

  function validate() {
    const e = {};
    if (!form.name.trim()) e.name = 'Fund name is required';
    if (!form.code.trim()) e.code = 'Fund code is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    try {
      if (modal === 'add') {
        const result = await createFund.mutateAsync(form);
        addToast(`Fund created with equity account ${result.equityAccount?.code}.`, 'success');
      } else {
        await updateFund.mutateAsync({ id: modal.id, ...form });
        addToast('Fund updated.', 'success');
      }
      setModal(null);
    } catch (err) {
      addToast(err.response?.data?.error || 'Failed to save fund.', 'error');
    }
  }

  async function handleDeactivate() {
    if (!confirm(`Deactivate "${modal.name}"? This will fail if the fund has a non-zero balance or transaction history.`)) return;
    try {
      await deleteFund.mutateAsync(modal.id);
      addToast('Fund deactivated.', 'success');
      setModal(null);
    } catch (err) {
      addToast(err.response?.data?.error || 'Cannot deactivate fund.', 'error');
    }
  }

  async function handleReactivate() {
    if (!confirm(`Reactivate "${modal.name}"? Its linked net asset account will also be reactivated.`)) return;
    try {
      await updateFund.mutateAsync({ id: modal.id, is_active: true });
      addToast('Fund reactivated.', 'success');
      setModal(null);
    } catch (err) {
      addToast(err.response?.data?.error || 'Cannot reactivate fund.', 'error');
    }
  }

  const isSaving = createFund.isPending || updateFund.isPending;
  const editingFund = modal && modal !== 'add' ? modal : null;

  const COLUMNS = [
    {
      key: 'name', label: 'Fund Name',
      render: (f) => (
        <div style={{ opacity: f.is_active ? 1 : 0.45 }}>
          <div style={{ fontWeight: 600, color: '#1e293b' }}>{f.name}</div>
          {f.description && <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{f.description}</div>}
        </div>
      ),
    },
    {
      key: 'net_asset', label: 'Net Asset Account',
      render: (f) => f.net_asset_code ? (
        <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: '#6b7280', opacity: f.is_active ? 1 : 0.45 }}>
          {f.net_asset_code} — {f.net_asset_name}
        </span>
      ) : <span style={{ color: '#d1d5db' }}>—</span>,
    },
    {
      key: 'status', label: 'Status',
      render: (f) => <Badge label={f.is_active ? 'Active' : 'Inactive'}
        variant={f.is_active ? 'active' : 'inactive'} />,
    },
    {
      key: 'actions', label: '', align: 'right',
      render: (f) => (
        <Button variant="secondary" size="sm" onClick={() => openEdit(f)}>Edit</Button>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>Funds</h1>
          <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
            Each fund automatically creates a linked equity (net assets) account.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <Button variant="secondary" onClick={() => setShowInactive((v) => !v)}>
            {showInactive ? 'Hide Inactive' : 'Show Inactive'}
          </Button>
          <Button onClick={openAdd}>+ Add Fund</Button>
        </div>
      </div>

      <Card>
	  <Table 
	    columns={COLUMNS}
	    rows={visibleFunds} 
	    isLoading={isLoading}
            emptyText="No funds created yet."
	  />
      </Card>

      <Modal isOpen={!!modal} onClose={() => setModal(null)}
        title={modal === 'add' ? 'Add Fund' : 'Edit Fund'}>
        <div style={{ display: 'grid', gap: '1rem' }}>
          <Input label="Fund Code" required value={form.code}
            onChange={set('code')} error={errors.code} placeholder="e.g., 3000" />
          <Input label="Fund Name" required value={form.name}
            onChange={set('name')} error={errors.name} placeholder="General Fund" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 500, color: '#374151' }}>Description</label>
            <textarea value={form.description} onChange={set('description')} rows={2}
              style={{ padding: '0.45rem 0.75rem', border: '1px solid #d1d5db',
                borderRadius: '6px', fontSize: '0.875rem', resize: 'vertical', fontFamily: 'inherit' }} />
          </div>
          {modal === 'add' && (
            <p style={{ fontSize: '0.78rem', color: '#6b7280', margin: 0 }}>
              An equity (net assets) account will be auto-created in the 3000–3899 range.
            </p>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
            {editingFund?.is_active && (
              <Button variant="ghost" onClick={handleDeactivate}
                isLoading={deleteFund.isPending}
                style={{ color: '#dc2626' }}>
                Deactivate Fund
              </Button>
            )}
            {editingFund && !editingFund.is_active && (
              <Button variant="ghost" onClick={handleReactivate}
                isLoading={updateFund.isPending}
                style={{ color: '#15803d' }}>
                Reactivate Fund
              </Button>
            )}
            {modal === 'add' && <span />}

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
              <Button onClick={handleSave} isLoading={isSaving}>
                {modal === 'add' ? 'Create Fund' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
