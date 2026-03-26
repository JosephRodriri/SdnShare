import { useState, useEffect, useCallback } from 'react'
import { Server, Monitor, AlertTriangle, Zap, Shield } from 'lucide-react'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid,
} from 'recharts'
import { topologyApi, anomaliesApi } from '../services/api'
import { useWebSocket } from '../hooks/useWebSocket'

const TICK  = { fontSize: 10, fill: '#484f58', fontFamily: 'JetBrains Mono, monospace' }
const TT    = { contentStyle: { background: '#161b22', border: '1px solid #30363d', borderRadius: '8px', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#e6edf3' }, labelStyle: { color: '#8b949e' } }
const SBADGE = { CRITICAL: 'badge-critical', HIGH: 'badge-high', MEDIUM: 'badge-medium', LOW: 'badge-low' }

export default function DashboardPage() {
  const [switches,   setSwitches]   = useState([])
  const [hosts,      setHosts]      = useState([])
  const [anomalies,  setAnomalies]  = useState([])
  const [stats,      setStats]      = useState(null)
  const [chartData,  setChartData]  = useState([])
  const [liveAlerts, setLiveAlerts] = useState([])
  const [loading,    setLoading]    = useState(true)

  const load = useCallback(async () => {
    try {
      const [swRes, hRes, anRes, stRes] = await Promise.all([
        topologyApi.getActiveSwitches(),
        topologyApi.getHosts(),
        anomaliesApi.getAll(true),
        anomaliesApi.getStats(),
      ])
      setSwitches(swRes.data ?? [])
      setHosts(hRes.data ?? [])
      setAnomalies(anRes.data ?? [])
      setStats(stRes.data ?? {})
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error cargando dashboard')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleWsMessage = useCallback((msg) => {
    if (msg.type === 'ANOMALY') {
      const a = msg.payload ?? msg.data ?? msg
      setLiveAlerts(prev => [a, ...prev.slice(0, 4)])
      setStats(s => s ? { ...s, unresolved: (s.unresolved || 0) + 1 } : s)
      if (a.severity === 'CRITICAL') {
        toast.error(`🚨 DDoS CRÍTICO — Switch ${a.switchId} Puerto ${a.portId}`, { duration: 8000 })
      } else if (a.severity === 'HIGH') {
        toast.error(`⚠️ Tráfico ALTO — ${a.hostName || 'Switch ' + a.switchId}`, { duration: 5000 })
      } else {
        toast(`📊 Anomalía ${a.severity} detectada`, { duration: 3000 })
      }
    }
    if (msg.type === 'PORT_METRIC') {
      const m = msg.payload ?? msg.data ?? msg
      setChartData(prev => {
        const punto = {
          time: format(new Date(m.timestamp ?? Date.now()), 'HH:mm:ss'),
          rx: Math.round((m.rxBytes ?? 0) / 1024),
          tx: Math.round((m.txBytes ?? 0) / 1024),
        }
        return [...prev.slice(-29), punto]
      })
    }
  }, [])

  useWebSocket(handleWsMessage)

  const onlineCount   = switches.filter(s => s.active ?? s.status === 'ONLINE').length
  const activeHosts   = hosts.filter(h => h.active ?? h.status === 'ONLINE').length
  const criticalCount = anomalies.filter(a => a.severity === 'CRITICAL').length

  // Attack type bar data from stats
  const attackBarData = stats?.byType24h
    ? Object.entries(stats.byType24h).map(([k, v]) => ({ name: k.replace('_', ' '), count: v }))
    : []

  if (loading) return <Loading />

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader title="Dashboard" sub="Monitoreo en tiempo real — SDN Spine-Leaf" />

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
        <KpiCard icon={<Server size={18} color="#06b6d4" />}      iconBg="rgba(6,182,212,0.1)"  iconBorder="rgba(6,182,212,0.3)"  value={onlineCount}       label="Switches Activos"  sub="online en red"      color="#06b6d4" />
        <KpiCard icon={<Monitor size={18} color="#4ade80" />}     iconBg="rgba(34,197,94,0.1)"  iconBorder="rgba(34,197,94,0.3)"  value={activeHosts}       label="Hosts Conectados"  sub="hosts activos"      color="#4ade80" />
        <KpiCard icon={<AlertTriangle size={18} color={criticalCount > 0 ? '#f87171' : '#eab308'} />} iconBg={criticalCount > 0 ? 'rgba(239,68,68,0.1)' : 'rgba(234,179,8,0.1)'} iconBorder={criticalCount > 0 ? 'rgba(239,68,68,0.3)' : 'rgba(234,179,8,0.3)'} value={anomalies.length} label="Anomalías Activas" sub={criticalCount > 0 ? `${criticalCount} críticas` : 'sin críticas'} color={criticalCount > 0 ? '#f87171' : '#eab308'} glow={criticalCount > 0} />
        <KpiCard icon={<Zap size={18} color="#fb923c" />}         iconBg="rgba(249,115,22,0.1)" iconBorder="rgba(249,115,22,0.3)" value={stats?.today ?? 0} label="Ataques Hoy"        sub="últimas 24h"        color="#fb923c" />
      </div>

      {/* Traffic chart */}
      <div className="panel">
        <div className="panel-header">
          <span style={LABEL_SM}>Tráfico de Red en Tiempo Real (KB/s)</span>
          <div style={{ display: 'flex', gap: '14px' }}>
            <Legend2 color="#06b6d4" label="RX" />
            <Legend2 color="#4ade80" label="TX" />
          </div>
        </div>
        <div style={{ padding: '16px', height: '220px' }}>
          {chartData.length === 0
            ? <Empty icon={<Server size={24} />} text="Esperando datos de red..." />
            : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="grx" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#06b6d4" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gtx" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="time" tick={TICK} />
                  <YAxis tick={TICK} />
                  <Tooltip {...TT} />
                  <Area type="monotone" dataKey="rx" stroke="#06b6d4" fill="url(#grx)" strokeWidth={1.5} name="RX (KB)" />
                  <Area type="monotone" dataKey="tx" stroke="#22c55e" fill="url(#gtx)" strokeWidth={1.5} name="TX (KB)" />
                </AreaChart>
              </ResponsiveContainer>
            )
          }
        </div>
      </div>

      {/* Row: attacks bar + live alerts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '14px' }}>
        {/* Attack bar chart */}
        <div className="panel">
          <div className="panel-header">
            <span style={LABEL_SM}>Distribución de Ataques por Tipo (24h)</span>
          </div>
          <div style={{ padding: '16px', height: '220px' }}>
            {attackBarData.length === 0
              ? <Empty icon={<AlertTriangle size={24} />} text="Sin datos de ataques" />
              : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={attackBarData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(48,54,61,0.5)" vertical={false} />
                    <XAxis dataKey="name" tick={TICK} />
                    <YAxis tick={TICK} />
                    <Tooltip {...TT} />
                    <Bar dataKey="count" name="Ataques" radius={[4, 4, 0, 0]}
                      fill="#ef4444"
                    />
                  </BarChart>
                </ResponsiveContainer>
              )
            }
          </div>
        </div>

        {/* Live alerts */}
        <div className="panel">
          <div className="panel-header">
            <span style={LABEL_SM}>Alertas Live</span>
            <div className="dot-danger" />
          </div>
          <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '220px', overflowY: 'auto' }}>
            {liveAlerts.length === 0
              ? <Empty icon={<Shield size={20} />} text="Sin alertas activas" small />
              : liveAlerts.map((a, i) => (
                <div key={i} style={{
                  background: a.severity === 'CRITICAL' ? 'rgba(239,68,68,0.05)' : '#161b22',
                  borderRadius: '6px', padding: '9px 10px',
                  borderLeft: a.severity === 'CRITICAL' ? '2px solid #ef4444' : '2px solid transparent',
                  border: a.severity !== 'CRITICAL' ? '1px solid #30363d' : undefined,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                    <span className={SBADGE[a.severity] ?? 'badge-info'}>{a.severity}</span>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58' }}>
                      {a.detectedAt ? format(new Date(a.detectedAt), 'HH:mm:ss') : '--:--:--'}
                    </span>
                  </div>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#e6edf3' }}>{a.anomalyType}</div>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58' }}>
                    s{a.switchId}:{a.portId}
                  </div>
                </div>
              ))
            }
          </div>
        </div>
      </div>

      {/* Switches grid */}
      <div className="panel">
        <div className="panel-header">
          <span style={LABEL_SM}>Estado de Switches</span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>{switches.length} dispositivos</span>
        </div>
        <div style={{ padding: '16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '10px' }}>
          {switches.length === 0
            ? <div style={{ gridColumn: '1/-1', ...MUTED_MONO }}>Sin switches activos</div>
            : switches.map(sw => {
              const isOnline = sw.active ?? sw.status === 'ONLINE'
              const isSpine  = sw.switchType === 'SPINE'
              return (
                <div key={sw.switchId ?? sw.id} style={{
                  background: isSpine ? 'rgba(6,182,212,0.04)' : 'rgba(34,197,94,0.04)',
                  border: `1px solid ${isSpine ? 'rgba(6,182,212,0.2)' : 'rgba(34,197,94,0.2)'}`,
                  borderRadius: '8px', padding: '12px', cursor: 'default',
                  transition: 'border-color 0.2s, box-shadow 0.2s',
                }}
                  onMouseEnter={e => e.currentTarget.style.boxShadow = isSpine ? '0 0 12px rgba(6,182,212,0.2)' : '0 0 12px rgba(34,197,94,0.2)'}
                  onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <div className={isOnline ? 'dot-online' : 'dot-offline'} />
                    <span className={isSpine ? 'badge-info' : 'badge-low'} style={{ fontSize: '10px' }}>{sw.switchType}</span>
                  </div>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: '#e6edf3' }}>{sw.name ?? sw.switchId}</div>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58' }}>ID: {sw.switchId ?? sw.id}</div>
                </div>
              )
            })
          }
        </div>
      </div>
    </div>
  )
}

// ── Shared mini-components ────────────────────────────────────────────────────
const LABEL_SM  = { fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.06em' }
const MUTED_MONO = { fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58', textAlign: 'center', padding: '20px' }

function KpiCard({ icon, iconBg, iconBorder, value, label, sub, color, glow }) {
  return (
    <div className="stat-card" style={{ boxShadow: glow ? '0 0 20px rgba(239,68,68,0.3)' : undefined }}>
      <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: iconBg, border: `1px solid ${iconBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '12px' }}>
        {icon}
      </div>
      <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: '28px', color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: '13px', color: '#8b949e', marginTop: '4px' }}>{label}</div>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58', marginTop: '2px' }}>{sub}</div>
    </div>
  )
}

function Legend2({ color, label }) {
  return (
    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color, display: 'flex', alignItems: 'center', gap: '4px' }}>
      <span style={{ width: '8px', height: '2px', background: color, display: 'inline-block' }} /> {label}
    </span>
  )
}

function Empty({ icon, text, small }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '8px', color: '#484f58' }}>
      {icon}
      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: small ? '11px' : '12px' }}>{text}</span>
    </div>
  )
}

function Loading() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: '#484f58' }}>Cargando sistema...</span>
    </div>
  )
}

function PageHeader({ title, sub }) {
  return (
    <div>
      <h1 style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: '20px', color: '#e6edf3', marginBottom: '4px' }}>{title}</h1>
      <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>{'>'} {sub}</p>
    </div>
  )
}
