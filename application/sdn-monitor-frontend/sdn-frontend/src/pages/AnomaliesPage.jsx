import { useState, useEffect, useCallback } from 'react'
import { AlertTriangle, CheckCircle, X, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { anomaliesApi } from '../services/api'
import { useWebSocket } from '../hooks/useWebSocket'

const SEVERITY_BADGE = {
  CRITICAL: 'badge-critical',
  HIGH:     'badge-high',
  MEDIUM:   'badge-medium',
  LOW:      'badge-low',
}

const SEVERITIES = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

function ResolveModal({ anomaly, onClose, onResolved }) {
  const [form, setForm] = useState({ resolvedBy: '', note: '' })
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.resolvedBy.trim() || !form.note.trim()) return
    setLoading(true)
    try {
      await anomaliesApi.resolve(anomaly.id, form)
      toast.success(`Anomalía #${anomaly.id} resuelta`)
      onResolved()
      onClose()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error al resolver')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(8,11,15,0.85)',
      backdropFilter: 'blur(4px)', zIndex: 50,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px'
    }}>
      <div className="panel animate-fade-in" style={{ width: '100%', maxWidth: '440px' }}>
        <div className="panel-header">
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: '#e6edf3' }}>
            Resolver Anomalía #{anomaly.id}
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#484f58' }}>
            <X size={16} />
          </button>
        </div>

        {/* Anomaly info */}
        <div style={{ padding: '16px 20px 0', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ background: '#161b22', borderRadius: '6px', padding: '12px', fontFamily: 'JetBrains Mono, monospace', fontSize: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ color: '#8b949e' }}>Tipo:</span>
              <span style={{ color: '#e6edf3' }}>{anomaly.anomalyType}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ color: '#8b949e' }}>Switch:Port:</span>
              <span style={{ color: '#22d3ee' }}>s{anomaly.switchId}:{anomaly.portId}</span>
            </div>
            {anomaly.hostName && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#8b949e' }}>Host:</span>
                <span style={{ color: '#e6edf3' }}>{anomaly.hostName}</span>
              </div>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px' }}>
              Resuelto por
            </label>
            <input
              className="input"
              placeholder="nombre.apellido"
              value={form.resolvedBy}
              onChange={e => setForm(f => ({ ...f, resolvedBy: e.target.value }))}
              required
            />
          </div>
          <div>
            <label style={{ display: 'block', fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px' }}>
              Nota
            </label>
            <input
              className="input"
              placeholder="Descripción de la resolución..."
              value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              required
            />
          </div>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {loading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle size={13} />}
              Resolver
            </button>
          </div>
        </form>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

export default function AnomaliesPage() {
  const [anomalies,  setAnomalies]  = useState([])
  const [stats,      setStats]      = useState({ unresolved: 0, total: 0, resolved: 0 })
  const [loading,    setLoading]    = useState(true)
  const [filter,     setFilter]     = useState('ALL')
  const [onlyActive, setOnlyActive] = useState(false)
  const [resolving,  setResolving]  = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [anRes, stRes] = await Promise.all([
        anomaliesApi.getAll(onlyActive, filter === 'ALL' ? undefined : filter),
        anomaliesApi.getStats(),
      ])
      setAnomalies(anRes.data ?? [])
      setStats(stRes.data ?? { unresolved: 0, total: 0, resolved: 0 })
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error cargando anomalías')
    } finally {
      setLoading(false)
    }
  }, [onlyActive, filter])

  useEffect(() => { load() }, [load])

  const handleWsMessage = useCallback((msg) => {
    if (msg.type === 'ANOMALY') {
      const a = msg.data ?? msg
      setAnomalies(prev => [a, ...prev])
      setStats(prev => ({ ...prev, unresolved: (prev.unresolved ?? 0) + 1 }))
    }
  }, [])

  useWebSocket(handleWsMessage)

  const criticalActive = anomalies.filter(a => a.severity === 'CRITICAL' && !a.resolvedAt).length
  const totalResolved  = anomalies.filter(a => !!a.resolvedAt).length

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header */}
      <div>
        <h1 style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: '20px', color: '#e6edf3', marginBottom: '4px' }}>
          Anomalías
        </h1>
        <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>
          {'>'} Detección DDoS y eventos de red en tiempo real
        </p>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
        {[
          { label: 'Sin Resolver',  value: stats.unresolved ?? 0, color: '#eab308' },
          { label: 'Críticas',      value: criticalActive,         color: '#ef4444' },
          { label: 'Total',         value: anomalies.length,       color: '#06b6d4' },
          { label: 'Resueltas',     value: totalResolved,          color: '#22c55e' },
        ].map(({ label, value, color }) => (
          <div key={label} className="panel" style={{ padding: '16px' }}>
            <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: '28px', color, lineHeight: 1 }}>{value}</div>
            <div style={{ fontSize: '12px', color: '#8b949e', marginTop: '4px' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="panel">
        <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            {SEVERITIES.map(s => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                style={{
                  fontFamily: 'JetBrains Mono, monospace', fontSize: '11px',
                  padding: '5px 12px', borderRadius: '5px', cursor: 'pointer', transition: 'all 0.15s',
                  background: filter === s ? 'rgba(6,182,212,0.15)' : 'transparent',
                  border: filter === s ? '1px solid rgba(6,182,212,0.4)' : '1px solid #30363d',
                  color: filter === s ? '#22d3ee' : '#8b949e',
                }}
              >
                {s}
              </button>
            ))}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={onlyActive}
              onChange={e => setOnlyActive(e.target.checked)}
              style={{ accentColor: '#06b6d4' }}
            />
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#8b949e' }}>
              Solo activas
            </span>
          </label>
        </div>
      </div>

      {/* Table */}
      <div className="panel">
        <div className="panel-header">
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Eventos Detectados
          </span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>
            {anomalies.length} registros
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
                  {['ID', 'Tipo', 'Severidad', 'Switch', 'Host', 'RX pps', 'TX pps', 'Detectada', 'Estado', 'Acción'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 400, whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {anomalies.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ padding: '32px', textAlign: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>
                      Sin anomalías registradas
                    </td>
                  </tr>
                ) : (
                  anomalies.map(a => {
                    const isCriticalActive = a.severity === 'CRITICAL' && !a.resolvedAt
                    return (
                      <tr
                        key={a.id}
                        style={{
                          borderBottom: '1px solid rgba(48,54,61,0.5)',
                          background: isCriticalActive ? 'rgba(239,68,68,0.04)' : 'transparent',
                          transition: 'background 0.15s',
                        }}
                        onMouseEnter={e => !isCriticalActive && (e.currentTarget.style.background = 'rgba(28,35,51,0.5)')}
                        onMouseLeave={e => e.currentTarget.style.background = isCriticalActive ? 'rgba(239,68,68,0.04)' : 'transparent'}
                      >
                        <td style={{ padding: '10px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>
                          #{a.id}
                        </td>
                        <td style={{ padding: '10px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#e6edf3', whiteSpace: 'nowrap' }}>
                          {a.anomalyType}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <span className={SEVERITY_BADGE[a.severity] ?? 'badge-info'}>{a.severity}</span>
                        </td>
                        <td style={{ padding: '10px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#8b949e' }}>
                          s{a.switchId}:{a.portId}
                        </td>
                        <td style={{ padding: '10px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#8b949e' }}>
                          {a.hostName ?? '—'}
                        </td>
                        <td style={{ padding: '10px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#ef4444' }}>
                          {a.rxPacketsPerSecond?.toLocaleString() ?? '—'}
                        </td>
                        <td style={{ padding: '10px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#f97316' }}>
                          {a.txPacketsPerSecond?.toLocaleString() ?? '—'}
                        </td>
                        <td style={{ padding: '10px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58', whiteSpace: 'nowrap' }}>
                          {a.detectedAt ? format(new Date(a.detectedAt), 'dd/MM HH:mm:ss') : '—'}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          {a.resolvedAt ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                              <CheckCircle size={12} color="#22c55e" />
                              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#22c55e' }}>Resuelta</span>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                              <div className="dot-danger" />
                              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#ef4444' }}>Activa</span>
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          {!a.resolvedAt && (
                            <button
                              onClick={() => setResolving(a)}
                              className="btn-ghost"
                              style={{ padding: '4px 10px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                            >
                              <CheckCircle size={11} />
                              Resolver
                            </button>
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

      {resolving && (
        <ResolveModal
          anomaly={resolving}
          onClose={() => setResolving(null)}
          onResolved={load}
        />
      )}
    </div>
  )
}
