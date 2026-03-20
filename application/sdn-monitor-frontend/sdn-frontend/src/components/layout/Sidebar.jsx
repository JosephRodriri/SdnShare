import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  Shield, LayoutDashboard, Network, AlertTriangle,
  Users, ChevronRight, LogOut
} from 'lucide-react'
import { useAuthStore } from '../../store/authStore'

const NAV_ITEMS = [
  { to: '/dashboard',  icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/topology',   icon: Network,         label: 'Topología' },
  { to: '/anomalies',  icon: AlertTriangle,   label: 'Anomalías' },
  { to: '/users',      icon: Users,           label: 'Usuarios' },
]

export default function Sidebar() {
  const { user, logout } = useAuthStore()
  const location = useLocation()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const initials = user
    ? `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase()
    : '??'

  return (
    <aside style={{
      width: '220px',
      minWidth: '220px',
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: '#0d1117',
      borderRight: '1px solid #30363d',
      padding: '0',
    }}>
      {/* Logo */}
      <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid #30363d' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
          <div style={{
            width: '32px', height: '32px', borderRadius: '8px',
            background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 12px rgba(6,182,212,0.2)'
          }}>
            <Shield size={16} color="#06b6d4" />
          </div>
          <span style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: '15px', color: '#e6edf3' }}>
            SDN Monitor
          </span>
        </div>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#22d3ee', paddingLeft: '42px', letterSpacing: '0.05em' }}>
          v1.0 — <span style={{ color: '#22c55e' }}>ACTIVE</span>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => {
          const isActive = location.pathname.startsWith(to)
          return (
            <NavLink
              key={to}
              to={to}
              className={`nav-link${isActive ? ' active' : ''}`}
              style={{ textDecoration: 'none', position: 'relative' }}
            >
              <Icon size={15} />
              <span style={{ flex: 1 }}>{label}</span>
              {isActive && <ChevronRight size={12} style={{ color: '#22d3ee' }} />}
            </NavLink>
          )
        })}
      </nav>

      {/* User */}
      <div style={{ padding: '12px 10px', borderTop: '1px solid #30363d' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px', marginBottom: '8px' }}>
          <div style={{
            width: '30px', height: '30px', borderRadius: '50%',
            background: '#1c2333', border: '1px solid #30363d',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#06b6d4',
            flexShrink: 0
          }}>
            {initials}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '13px', color: '#e6edf3', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user?.firstName} {user?.lastName}
            </div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58', textTransform: 'uppercase' }}>
              {user?.role ?? 'USER'}
            </div>
          </div>
        </div>
        <button
          onClick={handleLogout}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: '8px',
            padding: '8px 10px', borderRadius: '6px', border: 'none', cursor: 'pointer',
            background: 'transparent', color: '#ef4444', fontSize: '13px',
            transition: 'background 0.2s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.08)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <LogOut size={14} />
          <span>Cerrar sesión</span>
        </button>
      </div>
    </aside>
  )
}
