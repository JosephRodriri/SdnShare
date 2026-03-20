import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Shield, Terminal, UserPlus, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { authApi } from '../services/api'

const INITIAL = { firstName: '', lastName: '', email: '', password: '', phoneNumber: '', role: 'USER', direction: '' }

export default function RegisterPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState(INITIAL)
  const [loading, setLoading] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await authApi.register(form)
      toast.success('Cuenta creada exitosamente')
      navigate('/login')
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error al registrar')
    } finally {
      setLoading(false)
    }
  }

  const Field = ({ label, name, type = 'text', placeholder }) => (
    <div>
      <label style={{ display: 'block', fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px' }}>
        {label}
      </label>
      <input
        className="input"
        type={type}
        placeholder={placeholder}
        value={form[name]}
        onChange={e => set(name, e.target.value)}
        required
      />
    </div>
  )

  return (
    <div className="grid-bg" style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative', overflow: 'hidden', padding: '24px'
    }}>
      <div style={{
        position: 'fixed', top: '10%', right: '10%', width: '350px', height: '350px',
        background: 'radial-gradient(circle, rgba(6,182,212,0.05) 0%, transparent 70%)',
        borderRadius: '50%', filter: 'blur(40px)', pointerEvents: 'none'
      }} />

      <div style={{ width: '100%', maxWidth: '480px', position: 'relative', zIndex: 1 }}>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{
            width: '56px', height: '56px', borderRadius: '12px',
            background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.3)',
            boxShadow: '0 0 20px rgba(6,182,212,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 14px'
          }}>
            <Shield size={24} color="#06b6d4" />
          </div>
          <h1 style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: '22px', color: '#e6edf3', marginBottom: '4px' }}>
            Crear Cuenta
          </h1>
          <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>
            {'>'} Registro de nuevo operador
          </p>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Terminal size={14} color="#484f58" />
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                AUTH_SESSION — REGISTER
              </span>
            </div>
            <div style={{ display: 'flex', gap: '5px' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'rgba(239,68,68,0.6)' }} />
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'rgba(234,179,8,0.6)' }} />
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'rgba(34,197,94,0.6)' }} />
            </div>
          </div>

          <form onSubmit={handleSubmit} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <Field label="Nombre" name="firstName" placeholder="John" />
              <Field label="Apellido" name="lastName" placeholder="Doe" />
            </div>
            <Field label="Email" name="email" type="email" placeholder="user@sdn.local" />
            <Field label="Password" name="password" type="password" placeholder="••••••••" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <Field label="Teléfono" name="phoneNumber" placeholder="+57 300 0000000" />
              <div>
                <label style={{ display: 'block', fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px' }}>
                  Rol
                </label>
                <select
                  className="input"
                  value={form.role}
                  onChange={e => set('role', e.target.value)}
                  style={{ cursor: 'pointer' }}
                >
                  <option value="USER">USER</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
              </div>
            </div>
            <Field label="Dirección" name="direction" placeholder="Calle 123 #45-67" />

            <button className="btn-primary" type="submit" disabled={loading} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginTop: '4px' }}>
              {loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <UserPlus size={14} />}
              {loading ? 'Registrando...' : 'Crear Cuenta'}
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', marginTop: '16px', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>
          Ya tienes cuenta?{' '}
          <Link to="/login" style={{ color: '#06b6d4', textDecoration: 'none' }}>
            Iniciar sesión
          </Link>
        </p>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
