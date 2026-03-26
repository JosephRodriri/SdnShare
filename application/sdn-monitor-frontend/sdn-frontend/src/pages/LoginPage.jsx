import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Shield, Terminal, Eye, EyeOff, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { authApi } from '../services/api'
import { useAuthStore } from '../store/authStore'

export default function LoginPage() {
  const navigate = useNavigate()
  const { setAuth } = useAuthStore()
  const [form, setForm] = useState({ email: '', password: '' })
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const { data } = await authApi.login(form)
      setAuth(data.token, {
        firstName: data.firstName ?? data.user?.firstName ?? 'User',
        lastName:  data.lastName  ?? data.user?.lastName  ?? '',
        email:     data.email     ?? data.user?.email     ?? form.email,
        role:      data.role      ?? data.user?.role      ?? 'USER',
      })
      toast.success('Acceso autorizado')
      navigate('/dashboard')
    } catch (err) {
      toast.error(err.response?.data?.message || 'Credenciales inválidas')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid-bg" style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative', overflow: 'hidden', padding: '24px'
    }}>
      {/* Glow orbs */}
      <div style={{
        position: 'fixed', top: '10%', left: '5%', width: '400px', height: '400px',
        background: 'radial-gradient(circle, rgba(6,182,212,0.06) 0%, transparent 70%)',
        borderRadius: '50%', filter: 'blur(40px)', pointerEvents: 'none'
      }} />
      <div style={{
        position: 'fixed', bottom: '10%', right: '5%', width: '300px', height: '300px',
        background: 'radial-gradient(circle, rgba(34,197,94,0.04) 0%, transparent 70%)',
        borderRadius: '50%', filter: 'blur(40px)', pointerEvents: 'none'
      }} />

      <div style={{ width: '100%', maxWidth: '400px', position: 'relative', zIndex: 1 }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{
            width: '64px', height: '64px', borderRadius: '14px',
            background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.3)',
            boxShadow: '0 0 20px rgba(6,182,212,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px'
          }}>
            <Shield size={28} color="#06b6d4" />
          </div>
          <h1 style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: '24px', color: '#e6edf3', marginBottom: '6px' }}>
            SDN Monitor
          </h1>
          <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: '#484f58' }}>
            {'>'} Acceso al sistema de control
          </p>
        </div>

        {/* Panel */}
        <div className="panel">
          <div className="panel-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Terminal size={14} color="#484f58" />
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                AUTH_SESSION — LOGIN
              </span>
            </div>
            <div style={{ display: 'flex', gap: '5px' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'rgba(239,68,68,0.6)' }} />
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'rgba(234,179,8,0.6)' }} />
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'rgba(34,197,94,0.6)' }} />
            </div>
          </div>

          <form onSubmit={handleSubmit} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px' }}>
                Email
              </label>
              <input
                className="input"
                type="email"
                placeholder="admin@sdn.local"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                required
              />
            </div>

            <div>
              <label style={{ display: 'block', fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px' }}>
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  className="input"
                  type={showPw ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  required
                  style={{ paddingRight: '40px' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  style={{
                    position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', color: '#484f58', padding: '2px'
                  }}
                >
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <button className="btn-primary" type="submit" disabled={loading} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginTop: '4px' }}>
              {loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Shield size={14} />}
              {loading ? 'Autenticando...' : 'Iniciar Sesión'}
            </button>
          </form>
        </div>


      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
