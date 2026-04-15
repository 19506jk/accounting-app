// @ts-nocheck
import { useState }    from 'react';
import { useAuth }     from '../context/AuthContext';
import { useUsers, useCreateUser, useUpdateUserRole,
         useUpdateUserActive, useDeleteUser } from '../api/useUsers';
import { useToast }    from '../components/ui/Toast';
import Card    from '../components/ui/Card';
import Table   from '../components/ui/Table';
import Modal   from '../components/ui/Modal';
import Badge   from '../components/ui/Badge';
import Button  from '../components/ui/Button';
import Input   from '../components/ui/Input';
import Select  from '../components/ui/Select';
import { getErrorMessage } from '../utils/errors';
import type { Role, UserSummary } from '@shared/contracts';
import type { TableColumn } from '../components/ui/types';

const ROLE_OPTIONS: Array<{ value: Role; label: string }> = [
  { value: 'admin',  label: 'Admin' },
  { value: 'editor', label: 'Editor' },
  { value: 'viewer', label: 'Viewer' },
];

export default function UserManagement() {
  const { user: me }   = useAuth();
  const { addToast }   = useToast();
  const { data: users, isLoading } = useUsers();

  const createUser     = useCreateUser();
  const updateRole     = useUpdateUserRole();
  const updateActive   = useUpdateUserActive();
  const deleteUser     = useDeleteUser();

  const [showAdd, setShowAdd]   = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newRole,  setNewRole]  = useState<Role>('viewer');
  const [emailErr, setEmailErr] = useState('');

  async function handleAdd() {
    if (!newEmail.trim()) {
      setEmailErr('Email is required');
      return;
    }
    if (!/\S+@\S+\.\S+/.test(newEmail)) {
      setEmailErr('Please enter a valid email address');
      return;
    }
    setEmailErr('');
    try {
      await createUser.mutateAsync({ email: newEmail.trim(), role: newRole });
      addToast(`Invitation created for ${newEmail}`, 'success');
      setShowAdd(false);
      setNewEmail('');
      setNewRole('viewer');
    } catch (err) {
      addToast(getErrorMessage(err, 'Failed to add user.'), 'error');
    }
  }

  async function handleRoleChange(id: number, role: Role) {
    try {
      await updateRole.mutateAsync({ id, role });
      addToast('Role updated.', 'success');
    } catch (err) {
      addToast(getErrorMessage(err, 'Failed to update role.'), 'error');
    }
  }

  async function handleToggleActive(id: number, current: boolean) {
    try {
      await updateActive.mutateAsync({ id, is_active: !current });
      addToast(current ? 'User deactivated.' : 'User activated.', 'success');
    } catch (err) {
      addToast(getErrorMessage(err, 'Failed to update status.'), 'error');
    }
  }

  async function handleCancel(id: number) {
    if (!confirm('Cancel this pending invitation?')) return;
    try {
      await deleteUser.mutateAsync(id);
      addToast('Invitation cancelled.', 'success');
    } catch (err) {
      addToast(getErrorMessage(err, 'Failed to cancel.'), 'error');
    }
  }

  const isPending = (u: UserSummary) => !u.is_active;
  const isSelf    = (u: UserSummary) => u.id === me?.id;

  const COLUMNS: TableColumn<UserSummary>[] = [
    {
      key: 'name', label: 'User',
      render: (u) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {u.avatar_url && !isPending(u) ? (
            <img src={u.avatar_url} alt={u.name} referrerPolicy="no-referrer"
              style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: 32, height: 32, borderRadius: '50%',
              background: '#e5e7eb', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: '0.75rem', color: '#9ca3af' }}>
              ?
            </div>
          )}
          <div>
            <div style={{ fontWeight: 500, color: '#1e293b', fontSize: '0.875rem' }}>
              {isPending(u) ? <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>(Pending)</span> : u.name}
              {isSelf(u) && <span style={{ fontSize: '0.7rem', color: '#6b7280', marginLeft: '0.4rem' }}>(you)</span>}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{u.email}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'role', label: 'Role',
      render: (u) => (
        isSelf(u) ? (
          <Badge label={u.role} variant={u.role} />
        ) : (
          <select
            value={u.role}
            onChange={(e) => handleRoleChange(u.id, e.target.value as Role)}
            style={{ padding: '0.3rem 0.5rem', border: '1px solid #d1d5db',
              borderRadius: '6px', fontSize: '0.8rem', cursor: 'pointer' }}
          >
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        )
      ),
    },
    {
      key: 'status', label: 'Status',
      render: (u) => {
        if (isPending(u)) return <Badge label="Pending" variant="pending" />;
        return <Badge label={u.is_active ? 'Active' : 'Inactive'}
          variant={u.is_active ? 'active' : 'inactive'} />;
      },
    },
    {
      key: 'actions', label: '', align: 'right' as const,
      render: (u) => {
        if (isSelf(u)) return null;
        if (isPending(u)) return (
          <Button variant="ghost" size="sm"
            onClick={() => handleCancel(u.id)}
            isLoading={deleteUser.isPending}>
            Cancel
          </Button>
        );
        return (
          <Button
            variant={u.is_active ? 'secondary' : 'primary'}
            size="sm"
            onClick={() => handleToggleActive(u.id, u.is_active)}
            isLoading={updateActive.isPending}
          >
            {u.is_active ? 'Deactivate' : 'Activate'}
          </Button>
        );
      },
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>
            User Management
          </h1>
          <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
            Add users by email — they will be granted access on their first Google sign-in.
          </p>
        </div>
        <Button onClick={() => setShowAdd(true)}>+ Add User</Button>
      </div>

      <Card>
        <Table
          columns={COLUMNS}
          rows={users || []}
          isLoading={isLoading}
          emptyText="No users found."
        />
      </Card>

      {/* Add User Modal */}
      <Modal isOpen={showAdd} onClose={() => { setShowAdd(false); setEmailErr(''); }}
        title="Add User">
        <div style={{ display: 'grid', gap: '1rem' }}>
          <Input
            label="Google Email Address"
            required
            type="email"
            value={newEmail}
            onChange={(e) => { setNewEmail(e.target.value); setEmailErr(''); }}
            placeholder="user@gmail.com"
            error={emailErr}
          />
          <Select
            label="Role"
            required
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as Role)}
            options={ROLE_OPTIONS}
          />
          <p style={{ fontSize: '0.78rem', color: '#9ca3af', margin: 0 }}>
            The user will be able to sign in once they visit the app and click
            "Sign in with Google" using this email address.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
            <Button variant="secondary" onClick={() => { setShowAdd(false); setEmailErr(''); }}>
              Cancel
            </Button>
            <Button onClick={handleAdd} isLoading={createUser.isPending}>
              Add User
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
