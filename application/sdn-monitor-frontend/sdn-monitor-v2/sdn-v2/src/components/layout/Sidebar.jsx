import { useLocation, NavLink, useNavigate } from 'react-router-dom'
import {
  Shield, LayoutDashboard, Network, Activity,
  AlertTriangle, Bell, Users, LogOut, ChevronRight
} from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import { useRole } from '../../hooks/useRole'

const MAIN_NAV = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/topology',  icon: Network,         label: 'Topología' },
  { to: '/metrics',   icon: Activity,        label: 'Métricas' },
  { to: '/anomalies', icon: AlertTriangle,   label: 'Anomalías' },
]

const ADMIN_NAV = [
  { to: '/alerts', icon: Bell,  label: 'Alertas' },
  { to: '/users',  icon: Users, label: 'Usuarios' },
]

export default function Sidebar() {
  const { user, logout } = useAuthStore()
  const { isAdmin, role } = useRole()
  const location = useLocation()
  const navigate = useNavigate()

  const handleLogout = () => { logout(); navigate('/login') }

  const initials = user
    ? `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase()
    : '??'

  const NavItem = ({ to, icon: Icon, label }) => {
    const active = location.pathname.startsWith(to)
    return (
      <NavLink
        to={to}
        className={`nav-link${active ? ' active' : ''}`}
        style={{ textDecoration: 'none', position: 'relative' }}
      >
        <Icon size={15} />
        <span style={{ flex: 1 }}>{label}</span>
        {active && <ChevronRight size={12} style={{ color: '#22d3ee' }} />}
      </NavLink>
    )
  }

  return (
    <aside style={{
      width: '224px', minWidth: '224px', height: '100vh',
      display: 'flex', flexDirection: 'column',
      backgroundColor: '#0d1117', borderRight: '1px solid #30363d',
    }}>
      {/* Logo */}
      <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid #30363d' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
          <div style={{
            width: '32px', height: '32px', borderRadius: '8px',
            background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 12px rgba(6,182,212,0.2)',
          }}>
            <Shield size={16} color="#06b6d4" />
          </div>
          <span style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: '15px', color: '#e6edf3' }}>
            SDN Monitor
          </span>
        </div>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#22d3ee', paddingLeft: '42px' }}>
          v2.0 — <span style={{ color: '#4ade80' }}>ACTIVE</span>
        </div>
      </div>

      {/* Main Nav */}
      <nav style={{ padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '9px', color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.12em', padding: '4px 8px 8px' }}>
          Principal
        </div>
        {MAIN_NAV.map(item => <NavItem key={item.to} {...item} />)}
      </nav>

      {/* Admin Nav */}
      {isAdmin && (
        <nav style={{ padding: '4px 10px 12px', display: 'flex', flexDirection: 'column', gap: '2px', borderTop: '1px solid #30363d' }}>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '9px', color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.12em', padding: '8px 8px 4px' }}>
            Administración
          </div>
          {ADMIN_NAV.map(item => <NavItem key={item.to} {...item} />)}
        </nav>
      )}

      <div style={{ flex: 1 }} />

      {/* User Section */}
      <div style={{ padding: '12px 10px', borderTop: '1px solid #30363d' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px', marginBottom: '6px' }}>
          <div style={{
            width: '32px', height: '32px', borderRadius: '50%',
            background: '#1c2333', border: '1px solid #30363d',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#06b6d4', flexShrink: 0,
          }}>
            {initials}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '13px', color: '#e6edf3', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.firstName} {user?.lastName}
            </div>
            <span className={role === 'ADMIN' ? 'badge-admin' : 'badge-user'} style={{ fontSize: '9px' }}>
              {role}
            </span>
          </div>
        </div>
        <button
          onClick={handleLogout}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: '8px',
            padding: '8px 10px', borderRadius: '6px', border: 'none', cursor: 'pointer',
            background: 'transparent', color: '#ef4444', fontSize: '13px', transition: 'background 0.2s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.08)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <LogOut size={14} />
          Cerrar sesión
        </button>
      </div>
    </aside>
  )
}
