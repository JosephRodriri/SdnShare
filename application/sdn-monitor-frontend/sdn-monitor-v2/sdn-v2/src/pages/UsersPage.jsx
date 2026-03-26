import { useState, useEffect, useCallback } from 'react'
import { Users, UserCheck, UserX, Shield, Plus, Trash2, X, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { usersApi, authApi } from '../services/api'
import { useAuthStore } from '../store/authStore'

const LABEL_SM = { fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.06em' }
const MC = (color) => ({ padding: '10px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: color ?? '#e6edf3', whiteSpace: 'nowrap' })
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const EMPTY_FORM = { firstName: '', lastName: '', email: '', password: '', confirmPassword: '', phoneNumber: '', role: 'USER', direction: '' }

// ── RegisterModal ─────────────────────────────────────────────────────────────
function RegisterModal({ onClose, onCreated }) {
  const [form, setForm]     = useState({ ...EMPTY_FORM })
  const [loading, setLoading] = useState(false)
  const [errors, setErrors]   = useState({})

  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }))
    if (errors[k]) setErrors(e => ({ ...e, [k]: undefined }))
  }

  const validate = () => {
    const e = {}
    if (!form.firstName.trim())   e.firstName    = 'Requerido'
    if (!form.lastName.trim())    e.lastName     = 'Requerido'
    if (!EMAIL_RE.test(form.email)) e.email      = 'Email inválido'
    if (form.password.length < 6) e.password     = 'Mínimo 6 caracteres'
    if (form.password !== form.confirmPassword)  e.confirmPassword = 'Las contraseñas no coinciden'
    if (!form.phoneNumber.trim()) e.phoneNumber  = 'Requerido'
    if (!form.direction.trim())   e.direction    = 'Requerido'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = async (ev) => {
    ev.preventDefault()
    if (!validate()) return
    setLoading(true)
    try {
      const { confirmPassword, ...payload } = form
      await authApi.register(payload)
      toast.success('Usuario creado exitosamente')
      onCreated()
      onClose()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error al crear usuario')
    } finally {
      setLoading(false)
    }
  }

  const Field = ({ label, name, type = 'text', placeholder }) => (
    <div>
      <label style={{ display: 'block', fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '5px' }}>{label}</label>
      <input
        className="input"
        type={type}
        placeholder={placeholder}
        value={form[name]}
        onChange={e => set(name, e.target.value)}
        required
        style={errors[name] ? { borderColor: 'rgba(239,68,68,0.6)' } : {}}
      />
      {errors[name] && <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#f87171', marginTop: '3px' }}>{errors[name]}</div>}
    </div>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(8,11,15,0.85)', backdropFilter: 'blur(4px)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', overflowY: 'auto' }}>
      <div className="panel animate-fade-in" style={{ width: '100%', maxWidth: '520px' }}>
        <div className="panel-header">
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: '#e6edf3' }}>Nuevo Operador</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#484f58' }}><X size={16} /></button>
        </div>
        <div style={{ padding: '8px 20px', borderBottom: '1px solid #30363d', background: 'rgba(6,182,212,0.03)' }}>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58' }}>ADMIN_PANEL — CREAR_USUARIO</span>
        </div>
        <form onSubmit={handleSubmit} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Field label="Nombre"   name="firstName" placeholder="John" />
            <Field label="Apellido" name="lastName"  placeholder="Doe" />
          </div>
          <Field label="Email" name="email" type="email" placeholder="operador@sdn.local" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Field label="Password"         name="password"        type="password" placeholder="••••••••" />
            <Field label="Confirmar Password" name="confirmPassword" type="password" placeholder="••••••••" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Field label="Teléfono" name="phoneNumber" placeholder="+57 300 0000000" />
            <div>
              <label style={{ display: 'block', fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '5px' }}>Rol</label>
              <select className="input" value={form.role} onChange={e => set('role', e.target.value)} style={{ cursor: 'pointer' }}>
                <option value="USER">USER</option>
                <option value="ADMIN">ADMIN</option>
              </select>
            </div>
          </div>
          <Field label="Dirección" name="direction" placeholder="Calle 123 #45-67" />
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '4px' }}>
            <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? <Loader2 size={13} className="spin" /> : <Plus size={13} />}
              Crear Usuario
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
const FILTERS = [{ key: 'ALL', label: 'Todos' }, { key: 'active', label: 'Activos' }, { key: 'inactive', label: 'Inactivos' }]

export default function UsersPage() {
  const { user: me } = useAuthStore()
  const [users,   setUsers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [filter,  setFilter]  = useState('ALL')
  const [modal,   setModal]   = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await usersApi.getAll()
      setUsers(res.data ?? [])
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: '20px', color: '#e6edf3', marginBottom: '4px' }}>Usuarios del Sistema</h1>
          <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>{'>'} Gestión de operadores — Solo administradores</p>
        </div>
        <button className="btn-primary" onClick={() => setModal(true)}>
          <Plus size={14} /> Nuevo Usuario
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
        <StatCard icon={<Users size={16} color="#06b6d4" />}    iconBg="rgba(6,182,212,0.1)"  iconBorder="rgba(6,182,212,0.3)"  value={totalUsers}    label="Total"    color="#06b6d4" />
        <StatCard icon={<UserCheck size={16} color="#4ade80" />} iconBg="rgba(34,197,94,0.1)" iconBorder="rgba(34,197,94,0.3)" value={activeUsers}   label="Activos"  color="#4ade80" />
        <StatCard icon={<UserX size={16} color="#f87171" />}    iconBg="rgba(239,68,68,0.1)"  iconBorder="rgba(239,68,68,0.3)"  value={inactiveUsers} label="Inactivos" color="#f87171" />
        <StatCard icon={<Shield size={16} color="#eab308" />}   iconBg="rgba(234,179,8,0.1)"  iconBorder="rgba(234,179,8,0.3)"  value={adminUsers}    label="Admins"   color="#eab308" />
      </div>

      {/* Filters */}
      <div className="panel" style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: '6px' }}>
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)} style={{
              fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', padding: '5px 12px',
              borderRadius: '5px', cursor: 'pointer', transition: 'all 0.15s',
              background: filter === f.key ? 'rgba(6,182,212,0.15)' : 'transparent',
              border: filter === f.key ? '1px solid rgba(6,182,212,0.4)' : '1px solid #30363d',
              color: filter === f.key ? '#22d3ee' : '#8b949e',
            }}>{f.label}</button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="panel">
        <div className="panel-header">
          <span style={LABEL_SM}>Operadores</span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>{filtered.length} registros</span>
        </div>
        {loading
          ? <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: '#484f58' }}>Cargando...</div>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #30363d' }}>
                    {['Nombre', 'Email', 'Teléfono', 'Rol', 'Registro', 'Estado', 'Acciones'].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 400, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0
                    ? <tr><td colSpan={7} style={{ padding: '32px', textAlign: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>Sin usuarios en esta categoría</td></tr>
                    : filtered.map(u => {
                      const initials = `${u.firstName?.[0] ?? ''}${u.lastName?.[0] ?? ''}`.toUpperCase()
                      const isMe = u.email === me?.email
                      return (
                        <tr key={u.id} style={{ borderBottom: '1px solid rgba(48,54,61,0.5)', transition: 'background 0.15s' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'rgba(28,35,51,0.5)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          <td style={{ padding: '10px 14px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                              <div style={{ width: '30px', height: '30px', borderRadius: '50%', background: '#1c2333', border: '1px solid #30363d', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#06b6d4', flexShrink: 0 }}>
                                {initials}
                              </div>
                              <span style={{ fontSize: '13px', color: '#e6edf3', fontWeight: 500 }}>{u.firstName} {u.lastName}</span>
                              {isMe && <span className="badge-info" style={{ fontSize: '9px' }}>yo</span>}
                            </div>
                          </td>
                          <td style={MC('#8b949e')}>{u.email}</td>
                          <td style={MC('#8b949e')}>{u.phoneNumber ?? '—'}</td>
                          <td style={{ padding: '10px 14px' }}>
                            <span className={u.role === 'ADMIN' ? 'badge-admin' : 'badge-user'}>{u.role}</span>
                          </td>
                          <td style={MC('#484f58')}>{u.registrationDate ? format(new Date(u.registrationDate), 'dd/MM/yy') : '—'}</td>
                          <td style={{ padding: '10px 14px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                              <div className={u.active ? 'dot-online' : 'dot-offline'} />
                              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: u.active ? '#4ade80' : '#484f58' }}>
                                {u.active ? 'Activo' : 'Inactivo'}
                              </span>
                            </div>
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            {!isMe && (
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button onClick={() => handleToggle(u)} className="btn-ghost" style={{ padding: '4px 8px' }} title={u.active ? 'Desactivar' : 'Activar'}>
                                  {u.active ? <UserX size={13} color="#f87171" /> : <UserCheck size={13} color="#4ade80" />}
                                </button>
                                <button onClick={() => handleDelete(u)} className="btn-ghost" style={{ padding: '4px 8px' }} title="Eliminar">
                                  <Trash2 size={13} color="#f87171" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  }
                </tbody>
              </table>
            </div>
          )
        }
      </div>

      {modal && <RegisterModal onClose={() => setModal(false)} onCreated={load} />}
    </div>
  )
}

function StatCard({ icon, iconBg, iconBorder, value, label, color }) {
  return (
    <div className="stat-card">
      <div style={{ width: '32px', height: '32px', borderRadius: '7px', background: iconBg, border: `1px solid ${iconBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '10px' }}>
        {icon}
      </div>
      <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: '26px', color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: '12px', color: '#8b949e', marginTop: '4px' }}>{label}</div>
    </div>
  )
}
