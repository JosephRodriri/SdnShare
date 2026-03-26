import { useState, useEffect, useCallback } from 'react'
import { CheckCircle, X, Loader2, Shield } from 'lucide-react'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import {
  AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { anomaliesApi } from '../services/api'
import { useWebSocket } from '../hooks/useWebSocket'
import { useRole } from '../hooks/useRole'
import { formatPps, formatDuration } from '../utils/format'

const SEVERITIES = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
const SBADGE = { CRITICAL: 'badge-critical', HIGH: 'badge-high', MEDIUM: 'badge-medium', LOW: 'badge-low' }
const SCOLOR = { CRITICAL: '#ef4444', HIGH: '#f97316', MEDIUM: '#eab308', LOW: '#22c55e' }
const TT = { contentStyle: { background: '#161b22', border: '1px solid #30363d', borderRadius: '8px', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#e6edf3' }, labelStyle: { color: '#8b949e' } }
const TICK = { fontSize: 10, fill: '#484f58', fontFamily: 'JetBrains Mono, monospace' }
const LABEL_SM = { fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.06em' }

// ── ResolveModal ──────────────────────────────────────────────────────────────
function ResolveModal({ anomaly, onClose, onResolved }) {
  const [form, setForm]     = useState({ resolvedBy: '', note: '' })
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
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(8,11,15,0.85)', backdropFilter: 'blur(4px)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div className="panel animate-fade-in" style={{ width: '100%', maxWidth: '440px' }}>
        <div className="panel-header">
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: '#e6edf3' }}>Resolver Anomalía #{anomaly.id}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#484f58' }}><X size={16} /></button>
        </div>
        <div style={{ padding: '16px 20px 0' }}>
          <div style={{ background: '#161b22', borderRadius: '6px', padding: '12px', fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', marginBottom: '0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}><span style={{ color: '#8b949e' }}>Tipo:</span><span style={{ color: '#e6edf3' }}>{anomaly.anomalyType}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}><span style={{ color: '#8b949e' }}>Switch:Port:</span><span style={{ color: '#22d3ee' }}>s{anomaly.switchId}:{anomaly.portId}</span></div>
            {anomaly.hostName && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#8b949e' }}>Host:</span><span style={{ color: '#e6edf3' }}>{anomaly.hostName}</span></div>}
          </div>
        </div>
        <form onSubmit={handleSubmit} style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px' }}>Resuelto por</label>
            <input className="input" placeholder="nombre.apellido" value={form.resolvedBy} onChange={e => setForm(f => ({ ...f, resolvedBy: e.target.value }))} required />
          </div>
          <div>
            <label style={{ display: 'block', fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px' }}>Nota</label>
            <input className="input" placeholder="Descripción de la resolución..." value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} required />
          </div>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? <Loader2 size={13} className="spin" /> : <CheckCircle size={13} />}
              Resolver
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AnomaliesPage() {
  const { isAdmin } = useRole()
  const [anomalies,  setAnomalies]  = useState([])
  const [stats,      setStats]      = useState({})
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
      setStats(stRes.data ?? {})
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error cargando anomalías')
    } finally {
      setLoading(false)
    }
  }, [onlyActive, filter])

  useEffect(() => { load() }, [load])

  const handleWsMessage = useCallback((msg) => {
    if (msg.type === 'ANOMALY') {
      const a = msg.payload ?? msg.data ?? msg
      setAnomalies(prev => [a, ...prev])
      setStats(s => ({ ...s, unresolved: (s.unresolved ?? 0) + 1 }))
    }
  }, [])
  useWebSocket(handleWsMessage)

  const criticalActive = anomalies.filter(a => a.severity === 'CRITICAL' && !a.resolvedAt).length
  const resolved       = anomalies.filter(a => !!a.resolvedAt).length
  const total          = anomalies.length
  const resolutionRate = total > 0 ? Math.round((resolved / total) * 100) : 0

  // Timeline data: count per hour (last 24h from anomalies)
  const hourBuckets = {}
  anomalies.forEach(a => {
    if (!a.detectedAt) return
    const h = format(new Date(a.detectedAt), 'HH:00')
    if (!hourBuckets[h]) hourBuckets[h] = { time: h, CRITICAL: 0, HIGH: 0, MEDIUM: 0 }
    if (['CRITICAL', 'HIGH', 'MEDIUM'].includes(a.severity)) {
      hourBuckets[h][a.severity] = (hourBuckets[h][a.severity] ?? 0) + 1
    }
  })
  const timelineData = Object.values(hourBuckets).slice(-24)

  // Donut data by type
  const typeCount = {}
  anomalies.forEach(a => { typeCount[a.anomalyType ?? 'UNKNOWN'] = (typeCount[a.anomalyType ?? 'UNKNOWN'] ?? 0) + 1 })
  const typeColors = { DDOS: '#ef4444', HIGH_TRAFFIC: '#f97316', PACKET_LOSS: '#eab308' }
  const pieData = Object.entries(typeCount).map(([name, value]) => ({
    name, value, color: typeColors[name] ?? '#484f58',
  }))
  const totalPie = pieData.reduce((s, d) => s + d.value, 0)

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: '20px', color: '#e6edf3', marginBottom: '4px' }}>Anomalías</h1>
        <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>{'>'} Detección DDoS y eventos de red en tiempo real</p>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
        <div className="stat-card">
          <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: '28px', color: '#eab308', lineHeight: 1 }}>{stats.unresolved ?? 0}</div>
          <div style={{ fontSize: '12px', color: '#8b949e', marginTop: '4px' }}>Sin Resolver</div>
        </div>
        <div className="stat-card">
          <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: '28px', color: '#ef4444', lineHeight: 1 }}>{criticalActive}</div>
          <div style={{ fontSize: '12px', color: '#8b949e', marginTop: '4px' }}>Críticas Activas</div>
        </div>
        <div className="stat-card">
          <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: '28px', color: '#06b6d4', lineHeight: 1 }}>{stats.today ?? total}</div>
          <div style={{ fontSize: '12px', color: '#8b949e', marginTop: '4px' }}>Ataques hoy</div>
        </div>
        <div className="stat-card">
          <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: '28px', color: '#4ade80', lineHeight: 1 }}>{resolutionRate}%</div>
          <div style={{ fontSize: '12px', color: '#8b949e', marginTop: '4px' }}>Tasa de resolución</div>
          <div style={{ marginTop: '6px', height: '4px', borderRadius: '2px', background: '#1c2333', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${resolutionRate}%`, background: '#22c55e', borderRadius: '2px', transition: 'width 0.5s' }} />
          </div>
        </div>
      </div>

      {/* Timeline + Donut */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '14px' }}>
        <div className="panel">
          <div className="panel-header"><span style={LABEL_SM}>Timeline de Ataques (últimas 24h)</span></div>
          <div style={{ padding: '16px', height: '220px' }}>
            {timelineData.length === 0
              ? <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '8px', color: '#484f58' }}><Shield size={24} /><span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px' }}>Sin anomalías en el periodo</span></div>
              : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={timelineData}>
                    <defs>
                      <linearGradient id="gc" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} /><stop offset="95%" stopColor="#ef4444" stopOpacity={0} /></linearGradient>
                      <linearGradient id="gh" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f97316" stopOpacity={0.3} /><stop offset="95%" stopColor="#f97316" stopOpacity={0} /></linearGradient>
                      <linearGradient id="gm" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#eab308" stopOpacity={0.3} /><stop offset="95%" stopColor="#eab308" stopOpacity={0} /></linearGradient>
                    </defs>
                    <XAxis dataKey="time" tick={TICK} />
                    <YAxis tick={TICK} />
                    <Tooltip {...TT} />
                    <Legend wrapperStyle={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#8b949e' }} />
                    <Area type="monotone" dataKey="CRITICAL" stroke="#ef4444" fill="url(#gc)" strokeWidth={1.5} name="CRITICAL" />
                    <Area type="monotone" dataKey="HIGH"     stroke="#f97316" fill="url(#gh)" strokeWidth={1.5} name="HIGH" />
                    <Area type="monotone" dataKey="MEDIUM"   stroke="#eab308" fill="url(#gm)" strokeWidth={1.5} name="MEDIUM" />
                  </AreaChart>
                </ResponsiveContainer>
              )
            }
          </div>
        </div>

        <div className="panel">
          <div className="panel-header"><span style={LABEL_SM}>Por Tipo</span></div>
          <div style={{ padding: '16px', height: '220px', position: 'relative' }}>
            {pieData.length === 0
              ? <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>Sin datos</div>
              : (
                <>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" nameKey="name">
                        {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                      </Pie>
                      <Tooltip {...TT} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -52%)', textAlign: 'center', pointerEvents: 'none' }}>
                    <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: '20px', color: '#e6edf3' }}>{totalPie}</div>
                    <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '9px', color: '#484f58' }}>TOTAL</div>
                  </div>
                </>
              )
            }
          </div>
          {/* Legend below */}
          <div style={{ padding: '0 16px 14px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {pieData.map((d, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'JetBrains Mono, monospace', fontSize: '10px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#8b949e' }}>
                  <span style={{ width: '8px', height: '8px', background: d.color, borderRadius: '2px', display: 'inline-block' }} />
                  {d.name}
                </span>
                <span style={{ color: d.color }}>{d.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="panel" style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            {SEVERITIES.map(s => (
              <button key={s} onClick={() => setFilter(s)} style={{
                fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', padding: '5px 12px',
                borderRadius: '5px', cursor: 'pointer', transition: 'all 0.15s',
                background: filter === s ? 'rgba(6,182,212,0.15)' : 'transparent',
                border: filter === s ? '1px solid rgba(6,182,212,0.4)' : '1px solid #30363d',
                color: filter === s ? '#22d3ee' : '#8b949e',
              }}>{s}</button>
            ))}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input type="checkbox" checked={onlyActive} onChange={e => setOnlyActive(e.target.checked)} style={{ accentColor: '#06b6d4' }} />
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#8b949e' }}>Solo activas</span>
          </label>
        </div>
      </div>

      {/* Table */}
      <div className="panel">
        <div className="panel-header">
          <span style={LABEL_SM}>Eventos Detectados</span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>{anomalies.length} registros</span>
        </div>
        {loading
          ? <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px', fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: '#484f58' }}>Cargando...</div>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #30363d' }}>
                    {['ID', 'Tipo', 'Severidad', 'Switch', 'Host', 'RX pps', 'TX pps', 'Detectada', 'Duración', 'Estado', ...(isAdmin ? ['Acción'] : [])].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 400, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {anomalies.length === 0
                    ? <tr><td colSpan={isAdmin ? 11 : 10} style={{ padding: '32px', textAlign: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>Sin anomalías registradas</td></tr>
                    : anomalies.map(a => {
                      const isCritActive = a.severity === 'CRITICAL' && !a.resolvedAt
                      return (
                        <tr key={a.id} style={{ borderBottom: '1px solid rgba(48,54,61,0.5)', background: isCritActive ? 'rgba(239,68,68,0.04)' : 'transparent', transition: 'background 0.15s' }}
                          onMouseEnter={e => !isCritActive && (e.currentTarget.style.background = 'rgba(28,35,51,0.5)')}
                          onMouseLeave={e => e.currentTarget.style.background = isCritActive ? 'rgba(239,68,68,0.04)' : 'transparent'}
                        >
                          <td style={MC('#484f58')}>#{a.id}</td>
                          <td style={MC()}>{a.anomalyType}</td>
                          <td style={{ padding: '10px 14px' }}><span className={SBADGE[a.severity] ?? 'badge-info'}>{a.severity}</span></td>
                          <td style={MC('#8b949e')}>s{a.switchId}:{a.portId}</td>
                          <td style={MC('#8b949e')}>{a.hostName ?? '—'}</td>
                          <td style={MC('#f87171')}>{formatPps(a.rxPacketsPerSecond)}</td>
                          <td style={MC('#fb923c')}>{formatPps(a.txPacketsPerSecond)}</td>
                          <td style={MC('#484f58')}>{a.detectedAt ? format(new Date(a.detectedAt), 'dd/MM HH:mm:ss') : '—'}</td>
                          <td style={MC('#8b949e')}>{a.detectedAt ? formatDuration(a.detectedAt, a.resolvedAt) : '—'}</td>
                          <td style={{ padding: '10px 14px' }}>
                            {a.resolvedAt
                              ? <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}><CheckCircle size={12} color="#4ade80" /><span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#4ade80' }}>Resuelta</span></div>
                              : <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}><div className="dot-danger" /><span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#f87171' }}>Activa</span></div>
                            }
                          </td>
                          {isAdmin && (
                            <td style={{ padding: '10px 14px' }}>
                              {!a.resolvedAt && (
                                <button onClick={() => setResolving(a)} className="btn-ghost" style={{ padding: '4px 10px', fontSize: '11px' }}>
                                  <CheckCircle size={11} /> Resolver
                                </button>
                              )}
                            </td>
                          )}
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

      {resolving && <ResolveModal anomaly={resolving} onClose={() => setResolving(null)} onResolved={load} />}
    </div>
  )
}

const MC = (color) => ({ padding: '10px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: color ?? '#e6edf3', whiteSpace: 'nowrap' })
