import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth }    from '../context/AuthContext';
import RoleGuard      from './RoleGuard';

const NAV_LINKS = [
  { to: '/dashboard',               label: '📊 Dashboard' },
  { to: '/accounts',                label: '📒 Chart of Accounts' },
  { to: '/funds',                   label: '🏦 Funds' },
  { to: '/contacts',                label: '👥 Contacts' },
  { to: '/bills',                   label: '📄 Bills' },
  { to: '/transactions',            label: '💳 Transactions', end: true },
  { to: '/transactions/deposit',    label: '💰 Make a Deposit' },
  { to: '/transactions/expense',    label: '🧾 Record Expense' },
  { to: '/reconciliation',          label: '✅ Reconciliation' },
  { to: '/reports',                 label: '📈 Reports' },
];

const ADMIN_LINKS = [
  { to: '/settings', label: '⚙️ Settings' },
  { to: '/users',    label: '👤 Users' },
];

const SIDEBAR_W  = '240px';
const TOPBAR_H   = '56px';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate         = useNavigate();

  const linkStyle = ({ isActive }) => ({
    display:        'block',
    padding:        '0.6rem 1.25rem',
    borderRadius:   '6px',
    textDecoration: 'none',
    fontSize:       '0.875rem',
    fontWeight:     isActive ? 600 : 400,
    color:          isActive ? '#1d4ed8' : '#374151',
    background:     isActive ? '#eff6ff' : 'transparent',
    transition:     'background 0.15s, color 0.15s',
  });

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>

      {/* ── Topbar ─────────────────────────────────────────────────────── */}
      <header style={{
        position:      'fixed',
        top:           0,
        left:          0,
        right:         0,
        height:        TOPBAR_H,
        background:    '#ffffff',
        borderBottom:  '1px solid #e5e7eb',
        display:       'flex',
        alignItems:    'center',
        padding:       '0 1.5rem',
        zIndex:        100,
        gap:           '1rem',
      }}>
        <span style={{ fontWeight: 700, fontSize: '1rem', color: '#1e293b', flex: 1 }}>
          ⛪ Church Accounting
        </span>

        {/* User info + logout */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {user?.avatar_url && (
            <img
              src={user.avatar_url}
              alt={user.name}
              referrerPolicy="no-referrer"
              style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }}
            />
          )}
          <div style={{ lineHeight: 1.3 }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#1e293b' }}>
              {user?.name}
            </div>
            <div style={{ fontSize: '0.7rem', color: '#6b7280', textTransform: 'capitalize' }}>
              {user?.role}
            </div>
          </div>
          <button
            onClick={logout}
            style={{
              marginLeft:   '0.5rem',
              padding:      '0.35rem 0.8rem',
              border:       '1px solid #e5e7eb',
              borderRadius: '6px',
              background:   'white',
              cursor:       'pointer',
              fontSize:     '0.8rem',
              color:        '#6b7280',
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      {/* ── Sidebar ────────────────────────────────────────────────────── */}
      <aside style={{
        position:    'fixed',
        top:         TOPBAR_H,
        left:        0,
        bottom:      0,
        width:       SIDEBAR_W,
        background:  '#f8fafc',
        borderRight: '1px solid #e5e7eb',
        overflowY:   'auto',
        padding:     '1rem 0.75rem',
        zIndex:      90,
      }}>
        <nav>
          {/* Main links — all roles */}
          <div style={{ marginBottom: '0.25rem' }}>
            {NAV_LINKS.map(({ to, end, label }) => (
              <NavLink key={to} to={to} end={end} style={linkStyle}>
                {label}
              </NavLink>
            ))}
          </div>

          {/* Admin-only links */}
          <RoleGuard roles={['admin']}>
            <div style={{
              borderTop:  '1px solid #e5e7eb',
              marginTop:  '0.75rem',
              paddingTop: '0.75rem',
            }}>
              <div style={{
                fontSize:     '0.7rem',
                fontWeight:   600,
                color:        '#9ca3af',
                padding:      '0 1.25rem',
                marginBottom: '0.4rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}>
                Administration
              </div>
              {ADMIN_LINKS.map(({ to, label }) => (
                <NavLink key={to} to={to} style={linkStyle}>
                  {label}
                </NavLink>
              ))}
            </div>
          </RoleGuard>
        </nav>
      </aside>

      {/* ── Main content — only this area scrolls ──────────────────────── */}
      <main style={{
        marginLeft: SIDEBAR_W,
        marginTop:  TOPBAR_H,
        minHeight:  `calc(100vh - ${TOPBAR_H})`,
        padding:    '2rem',
        background: '#ffffff',
        overflowY:  'auto',
      }}>
        <Outlet />
      </main>

    </div>
  );
}
