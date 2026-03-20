import { useState, useEffect, useCallback } from 'react'
import { Users, UserCheck, UserX, Shield, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { usersApi } from '../services/api'
import { useAuthStore } from '../store/authStore'

const FILTERS = [
  { key: 'ALL',      label: 'Todos' },
  { key: 'active',   label: 'Activos' },
  { key: 'inactive', label: 'Inactivos' },
]

export default function UsersPage() {
  const { user: me } = useAuthStore()
  const [users,   setUsers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [filter,  setFilter]  = useState('ALL')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [usersRes, meRes] = await Promise.all([
        usersApi.getAll(),
        usersApi.getMe(),
      ])
      setUsers(usersRes.data ?? [])
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error cargando usuarios')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = users.filter(u =>
    filter === 'ALL'      ? true :
    filter === 'active'   ? u.active :
    !u.active
  )

  const handleToggle = async (u) => {
    try {
      if (u.active) {
        await usersApi.deactivate(u.id)
        toast.success(`${u.firstName} desactivado`)
      } else {
        await usersApi.activate(u.id)
        toast.success(`${u.firstName} activado`)
      }
      load()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error al cambiar estado')
    }
  }

  const handleDelete = async (u) => {
    if (!window.confirm(`¿Eliminar a ${u.firstName} ${u.lastName}?`)) return
    try {
      await usersApi.delete(u.id)
      toast.success('Usuario eliminado')
      load()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error al eliminar')
    }
  }

  const totalUsers    = users.length
  const activeUsers   = users.filter(u => u.active).length
  const inactiveUsers = users.filter(u => !u.active).length
  const adminUsers    = users.filter(u => u.role === 'ADMIN').length

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header */}
      <div>
        <h1 style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: '20px', color: '#e6edf3', marginBottom: '4px' }}>
          Usuarios
        </h1>
        <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>
          {'>'} Gestión de operadores del sistema
        </p>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
        <StatCard icon={<Users size={16} color="#06b6d4" />}   iconBg="rgba(6,182,212,0.1)"  iconBorder="rgba(6,182,212,0.3)"  value={totalUsers}    label="Total"    color="#06b6d4" />
        <StatCard icon={<UserCheck size={16} color="#22c55e" />} iconBg="rgba(34,197,94,0.1)" iconBorder="rgba(34,197,94,0.3)" value={activeUsers}   label="Activos"  color="#22c55e" />
        <StatCard icon={<UserX size={16} color="#ef4444" />}   iconBg="rgba(239,68,68,0.1)"  iconBorder="rgba(239,68,68,0.3)"  value={inactiveUsers} label="Inactivos" color="#ef4444" />
        <StatCard icon={<Shield size={16} color="#eab308" />}  iconBg="rgba(234,179,8,0.1)"  iconBorder="rgba(234,179,8,0.3)"  value={adminUsers}    label="Admins"   color="#eab308" />
      </div>

      {/* Filters */}
      <div className="panel">
        <div style={{ padding: '12px 16px', display: 'flex', gap: '6px' }}>
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                fontFamily: 'JetBrains Mono, monospace', fontSize: '11px',
                padding: '5px 12px', borderRadius: '5px', cursor: 'pointer', transition: 'all 0.15s',
                background: filter === f.key ? 'rgba(6,182,212,0.15)' : 'transparent',
                border: filter === f.key ? '1px solid rgba(6,182,212,0.4)' : '1px solid #30363d',
                color: filter === f.key ? '#22d3ee' : '#8b949e',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="panel">
        <div className="panel-header">
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Operadores
          </span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>
            {filtered.length} registros
          </span>
        </div>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px', fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: '#484f58' }}>
            Cargando...
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #30363d' }}>
                  {['Nombre', 'Email', 'Teléfono', 'Rol', 'Registro', 'Estado', 'Acciones'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 400, whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: '32px', textAlign: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>
                      Sin usuarios en esta categoría
                    </td>
                  </tr>
                ) : (
                  filtered.map(u => {
                    const initials = `${u.firstName?.[0] ?? ''}${u.lastName?.[0] ?? ''}`.toUpperCase()
                    const isMe     = u.email === me?.email
                    return (
                      <tr
                        key={u.id}
                        style={{ borderBottom: '1px solid rgba(48,54,61,0.5)', transition: 'background 0.15s' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(28,35,51,0.5)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <td style={{ padding: '10px 14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{
                              width: '28px', height: '28px', borderRadius: '50%',
                              background: '#1c2333', border: '1px solid #30363d',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#06b6d4',
                              flexShrink: 0
                            }}>
                              {initials}
                            </div>
                            <span style={{ fontSize: '13px', color: '#e6edf3' }}>
                              {u.firstName} {u.lastName}
                            </span>
                            {isMe && <span className="badge-info" style={{ fontSize: '10px' }}>yo</span>}
                          </div>
                        </td>
                        <td style={{ padding: '10px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#8b949e' }}>
                          {u.email}
                        </td>
                        <td style={{ padding: '10px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#8b949e' }}>
                          {u.phoneNumber ?? '—'}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <span className={u.role === 'ADMIN' ? 'badge-critical' : 'badge-info'}>
                            {u.role}
                          </span>
                        </td>
                        <td style={{ padding: '10px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58', whiteSpace: 'nowrap' }}>
                          {u.registrationDate ? format(new Date(u.registrationDate), 'dd/MM/yy') : '—'}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <div className={u.active ? 'dot-online' : 'dot-offline'} />
                            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: u.active ? '#22c55e' : '#484f58' }}>
                              {u.active ? 'Activo' : 'Inactivo'}
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          {!isMe && (
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <button
                                onClick={() => handleToggle(u)}
                                className="btn-ghost"
                                style={{ padding: '4px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                                title={u.active ? 'Desactivar' : 'Activar'}
                              >
                                {u.active
                                  ? <UserX size={12} color="#ef4444" />
                                  : <UserCheck size={12} color="#22c55e" />
                                }
                              </button>
                              <button
                                onClick={() => handleDelete(u)}
                                className="btn-ghost"
                                style={{ padding: '4px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                                title="Eliminar"
                              >
                                <Trash2 size={12} color="#ef4444" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ icon, iconBg, iconBorder, value, label, color }) {
  return (
    <div className="panel" style={{ padding: '16px' }}>
      <div style={{ width: '32px', height: '32px', borderRadius: '7px', background: iconBg, border: `1px solid ${iconBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '10px' }}>
        {icon}
      </div>
      <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: '26px', color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: '12px', color: '#8b949e', marginTop: '4px' }}>{label}</div>
    </div>
  )
}
