import { useState, useCallback }  from 'react';
import {
  useContacts,
  useContact,
  useCreateContact,
  useUpdateContact,
  useDeleteContact,
  useDeactivateContact,
} from '../api/useContacts';
import { useAuth }    from '../context/AuthContext';
import { useToast }   from '../components/ui/Toast';
import Card    from '../components/ui/Card';
import Table   from '../components/ui/Table';
import Drawer  from '../components/ui/Drawer';
import Badge   from '../components/ui/Badge';
import Button  from '../components/ui/Button';
import Input   from '../components/ui/Input';
import Select  from '../components/ui/Select';

const PROVINCES = ['AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT']
  .map((p) => ({ value: p, label: p }));

const TYPE_OPTIONS = [
  { value: 'DONOR', label: 'Donor' },
  { value: 'PAYEE', label: 'Payee' },
  { value: 'BOTH',  label: 'Both' },
];

const CLASS_OPTIONS = [
  { value: 'INDIVIDUAL', label: 'Individual' },
  { value: 'HOUSEHOLD',  label: 'Household' },
];

const DONOR_TYPES = ['DONOR', 'BOTH'];
const isDonorType = (type) => DONOR_TYPES.includes(type?.toUpperCase());

const EMPTY_FORM = {
  type: 'DONOR', contact_class: 'INDIVIDUAL',
  name: '', first_name: '', last_name: '',
  email: '', phone: '',
  address_line1: '', address_line2: '',
  city: '', province: 'ON', postal_code: '',
  notes: '', donor_id: '',
};

function ContactForm({ form, setForm, errors = {} }) {
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const isHousehold = form.contact_class === 'HOUSEHOLD';
  const showDonorId = isDonorType(form.type);

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <Select label="Type" required value={form.type} onChange={set('type')}
          options={TYPE_OPTIONS} />
        <Select label="Class" required value={form.contact_class}
          onChange={set('contact_class')} options={CLASS_OPTIONS} />
      </div>

      {/* Donor ID — only shown for DONOR or BOTH */}
      {showDonorId && (
        <Input
          label="Donor ID"
          required
          value={form.donor_id}
          onChange={set('donor_id')}
          error={errors.donor_id}
          placeholder="e.g. 5-12345"
        />
      )}

      <Input label="Display Name" required value={form.name}
        onChange={set('name')} error={errors.name}
        placeholder={isHousehold ? 'John & Jane Smith' : 'John Smith'} />

      {!isHousehold && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <Input label="First Name" value={form.first_name} onChange={set('first_name')} />
          <Input label="Last Name"  value={form.last_name}  onChange={set('last_name')} />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <Input label="Email" type="email" value={form.email} onChange={set('email')} />
        <Input label="Phone" value={form.phone} onChange={set('phone')} />
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid #f3f4f6', margin: '0.25rem 0' }} />

      <Input label="Address Line 1" value={form.address_line1} onChange={set('address_line1')} />
      <Input label="Address Line 2" value={form.address_line2} onChange={set('address_line2')} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <Input label="City" value={form.city} onChange={set('city')} />
        <Select label="Province" value={form.province} onChange={set('province')}
          options={PROVINCES} />
      </div>

      <Input label="Postal Code" value={form.postal_code} onChange={set('postal_code')}
        placeholder="A1A 1A1" style={{ maxWidth: '180px' }} />

      <hr style={{ border: 'none', borderTop: '1px solid #f3f4f6', margin: '0.25rem 0' }} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        <label style={{ fontSize: '0.8rem', fontWeight: 500, color: '#374151' }}>Notes</label>
        <textarea
          value={form.notes}
          onChange={set('notes')}
          rows={2}
          style={{ padding: '0.45rem 0.75rem', border: '1px solid #d1d5db',
            borderRadius: '6px', fontSize: '0.875rem', resize: 'vertical',
            fontFamily: 'inherit' }}
        />
      </div>
    </div>
  );
}

export default function Contacts() {
  const { addToast } = useToast();
  const { user } = useAuth();

  const [search,      setSearch]      = useState('');
  const [typeFilter,  setTypeFilter]  = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [drawer,      setDrawer]      = useState(null); // null | 'add' | contact object
  const [form,        setForm]        = useState(EMPTY_FORM);
  const [errors,      setErrors]      = useState({});

  const { data: contacts, isLoading } = useContacts({
    search:           search || undefined,
    type:             typeFilter || undefined,
    include_inactive: showInactive,
  });

  const createContact = useCreateContact();
  const updateContact = useUpdateContact();
  const deleteContact = useDeleteContact();
  const deactivateContact = useDeactivateContact();

  const editingContactId = drawer && drawer !== 'add' ? drawer.id : null;
  const { data: drawerContact } = useContact(editingContactId, {
    enabled: !!editingContactId,
    refetchOnMount: false,
    staleTime: 60_000,
  });
  const activeDrawerContact = drawer && drawer !== 'add'
    ? (drawerContact || drawer)
    : null;
  const isAdmin = user?.role === 'admin';

  const openAdd = useCallback(() => {
    setForm(EMPTY_FORM);
    setErrors({});
    setDrawer('add');
  }, []);

  const openEdit = useCallback((contact) => {
    setForm({
      type:          contact.type,
      contact_class: contact.contact_class,
      name:          contact.name          || '',
      first_name:    contact.first_name    || '',
      last_name:     contact.last_name     || '',
      email:         contact.email         || '',
      phone:         contact.phone         || '',
      address_line1: contact.address_line1 || '',
      address_line2: contact.address_line2 || '',
      city:          contact.city          || '',
      province:      contact.province      || 'ON',
      postal_code:   contact.postal_code   || '',
      notes:         contact.notes         || '',
      donor_id:      contact.donor_id      || '',
    });
    setErrors({});
    setDrawer(contact);
  }, []);

  const closeDrawer = useCallback(() => setDrawer(null), []);

  function validate() {
    const errs = {};
    if (!form.name.trim()) errs.name = 'Display name is required';
    if (isDonorType(form.type) && !form.donor_id.trim()) {
      errs.donor_id = 'Donor ID is required for Donor or Both contact types';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    try {
      if (drawer === 'add') {
        await createContact.mutateAsync(form);
        addToast('Contact added successfully.', 'success');
      } else {
        await updateContact.mutateAsync({ id: drawer.id, ...form });
        addToast('Contact updated.', 'success');
      }
      closeDrawer();
    } catch (err) {
      const msg = err.response?.data?.error || 'Something went wrong.';
      addToast(msg, 'error');
    }
  }

  async function handleDeactivate() {
    if (!activeDrawerContact || !confirm(`Deactivate ${activeDrawerContact.name}?`)) return;
    try {
      await deactivateContact.mutateAsync(activeDrawerContact.id);
      addToast('Contact deactivated.', 'success');
      closeDrawer();
    } catch (err) {
      addToast(err.response?.data?.error || 'Cannot deactivate contact.', 'error');
    }
  }

  async function handleReactivate() {
    if (!activeDrawerContact || !confirm(`Reactivate ${activeDrawerContact.name}?`)) return;
    try {
      await updateContact.mutateAsync({ id: activeDrawerContact.id, is_active: true });
      addToast('Contact reactivated.', 'success');
      closeDrawer();
    } catch (err) {
      addToast(err.response?.data?.error || 'Cannot reactivate contact.', 'error');
    }
  }

  async function handleDelete() {
    if (!activeDrawerContact) return;
    if (!confirm(`Permanently delete ${activeDrawerContact.name}? This cannot be undone.`)) return;
    try {
      await deleteContact.mutateAsync(activeDrawerContact.id);
      addToast('Contact deleted.', 'success');
      closeDrawer();
    } catch (err) {
      addToast(err.response?.data?.error || 'Cannot delete contact.', 'error');
    }
  }

  const isSaving = createContact.isPending || updateContact.isPending;

  const COLUMNS = [
    {
      key: 'name', label: 'Name',
      render: (c) => (
        <div style={{ opacity: c.is_active ? 1 : 0.45 }}>
          <div style={{ fontWeight: 500, color: '#1e293b' }}>{c.name}</div>
          {c.email && <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{c.email}</div>}
        </div>
      ),
    },
    {
      key: 'donor_id', label: 'Donor ID',
      render: (c) => c.donor_id
        ? <span style={{ fontSize: '0.8rem', fontFamily: 'monospace', color: '#374151' }}>{c.donor_id}</span>
        : <span style={{ color: '#d1d5db' }}>—</span>,
    },
    {
      key: 'type', label: 'Type',
      render: (c) => <Badge label={c.type.toLowerCase()} variant={c.type.toLowerCase()} />,
    },
    {
      key: 'contact_class', label: 'Class',
      render: (c) => (
        <span style={{ fontSize: '0.8rem', color: '#6b7280', textTransform: 'capitalize' }}>
          {c.contact_class.toLowerCase()}
        </span>
      ),
    },
    {
      key: 'city', label: 'Location',
      render: (c) => c.city
        ? `${c.city}${c.province ? ', ' + c.province : ''}`
        : <span style={{ color: '#d1d5db' }}>—</span>,
    },
    {
      key: 'status', label: 'Status',
      render: (c) => !c.is_active
        ? <Badge label="Inactive" variant="inactive" />
        : null,
    },
    {
      key: 'actions', label: '', align: 'right',
      render: (c) => (
        <Button variant="secondary" size="sm" onClick={() => openEdit(c)}>Edit</Button>
      ),
    },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>
          Contacts & Donors
        </h1>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <Button variant="secondary" onClick={() => setShowInactive((v) => !v)}>
            {showInactive ? 'Hide Inactive' : 'Show Inactive'}
          </Button>
          <Button onClick={openAdd}>+ Add Contact</Button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, or donor ID…"
          style={{ padding: '0.45rem 0.75rem', border: '1px solid #d1d5db',
            borderRadius: '6px', fontSize: '0.875rem', width: '260px' }}
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          style={{ padding: '0.45rem 0.75rem', border: '1px solid #d1d5db',
            borderRadius: '6px', fontSize: '0.875rem', cursor: 'pointer' }}
        >
          <option value="">All Types</option>
          <option value="DONOR">Donors</option>
          <option value="PAYEE">Payees</option>
          <option value="BOTH">Both</option>
        </select>
      </div>

      <Card>
        <Table
          columns={COLUMNS}
          rows={contacts || []}
          isLoading={isLoading}
          emptyText="No contacts found. Add one to get started."
        />
      </Card>

      {/* Add / Edit Drawer */}
      <Drawer
        isOpen={!!drawer}
        onClose={closeDrawer}
        title={drawer === 'add' ? 'Add Contact' : 'Edit Contact'}
        width="600px"
      >
        <ContactForm form={form} setForm={setForm} errors={errors} />

        <div style={{ display: 'flex', justifyContent: activeDrawerContact ? 'space-evenly' : 'flex-end',
          alignItems: 'center', gap: '0.75rem', marginTop: '1.5rem', paddingTop: '1rem',
          borderTop: '1px solid #f3f4f6' }}>
          {/* Deactivate / Reactivate (edit only) */}
          {activeDrawerContact && (
            activeDrawerContact.is_active ? (
              <Button variant="ghost" onClick={handleDeactivate}
                isLoading={deactivateContact.isPending}
                style={{ color: '#dc2626' }}>
                Deactivate
              </Button>
            ) : (
              <Button variant="ghost" onClick={handleReactivate}
                isLoading={updateContact.isPending}
                style={{ color: '#15803d' }}>
                Reactivate
              </Button>
            )
          )}
          {activeDrawerContact && isAdmin && (
            <Button variant="ghost" onClick={handleDelete}
              isLoading={deleteContact.isPending}
              style={{ color: '#b91c1c' }}>
              Delete Contact
            </Button>
          )}

          {/* Cancel / Save */}
          <Button variant="secondary" onClick={closeDrawer}>Cancel</Button>
          <Button onClick={handleSave} isLoading={isSaving}>
            {drawer === 'add' ? 'Add Contact' : 'Save Changes'}
          </Button>
        </div>
      </Drawer>
    </div>
  );
}
