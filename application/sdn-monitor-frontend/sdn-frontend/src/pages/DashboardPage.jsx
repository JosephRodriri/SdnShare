import { useState, useEffect, useCallback } from 'react'
import { Server, Wifi, AlertTriangle, Activity } from 'lucide-react'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer
} from 'recharts'
import { topologyApi, anomaliesApi } from '../services/api'
import { useWebSocket } from '../hooks/useWebSocket'

const SEVERITY_BADGE = {
  CRITICAL: 'badge-critical',
  HIGH:     'badge-high',
  MEDIUM:   'badge-medium',
  LOW:      'badge-low',
}

export default function DashboardPage() {
  const [switches,   setSwitches]   = useState([])
  const [anomalies,  setAnomalies]  = useState([])
  const [stats,      setStats]      = useState({ unresolved: 0, byType24h: {} })
  const [chartData,  setChartData]  = useState([])
  const [liveAlerts, setLiveAlerts] = useState([])
  const [loading,    setLoading]    = useState(true)

  const load = useCallback(async () => {
    try {
      const [swRes, anRes, stRes] = await Promise.all([
        topologyApi.getActiveSwitches(),
        anomaliesApi.getAll(true),
        anomaliesApi.getStats(),
      ])
      setSwitches(swRes.data ?? [])
      setAnomalies(anRes.data ?? [])
      setStats(stRes.data ?? { unresolved: 0, byType24h: {} })
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error cargando datos')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleWsMessage = useCallback((msg) => {
    if (msg.type === 'ANOMALY') {
      const a = msg.data ?? msg
      setLiveAlerts(prev => [a, ...prev].slice(0, 5))
      setAnomalies(prev => [a, ...prev])
      if (a.severity === 'CRITICAL') {
        toast.error(`🚨 CRÍTICO: ${a.anomalyType} — s${a.switchId}:${a.portId}`)
      } else {
        toast.error(`⚠️ ${a.severity}: ${a.anomalyType}`)
      }
    } else if (msg.type === 'PORT_METRIC') {
      const m = msg.data ?? msg
      const point = {
        time: format(new Date(m.timestamp), 'HH:mm:ss'),
        rx: Math.round((m.rxBytes ?? 0) / 1024),
        tx: Math.round((m.txBytes ?? 0) / 1024),
      }
      setChartData(prev => [...prev, point].slice(-30))
    }
  }, [])

  useWebSocket(handleWsMessage)

  const criticalCount = anomalies.filter(a => a.severity === 'CRITICAL').length
  const onlineCount   = switches.filter(s => s.active ?? s.status === 'ONLINE').length

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: '#484f58' }}>
          Cargando sistema...
        </div>
      </div>
    )
  }

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header */}
      <div>
        <h1 style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: '20px', color: '#e6edf3', marginBottom: '4px' }}>
          Dashboard
        </h1>
        <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>
          {'>'} Monitoreo en tiempo real — SDN Spine-Leaf
        </p>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
        <KpiCard
          icon={<Server size={18} color="#06b6d4" />}
          iconBg="rgba(6,182,212,0.1)"
          iconBorder="rgba(6,182,212,0.3)"
          value={switches.length}
          label="Switches Activos"
          sub="total en red"
          color="#06b6d4"
        />
        <KpiCard
          icon={<Wifi size={18} color="#22c55e" />}
          iconBg="rgba(34,197,94,0.1)"
          iconBorder="rgba(34,197,94,0.3)"
          value={onlineCount}
          label="Switches Online"
          sub={`de ${switches.length} total`}
          color="#22c55e"
          glow={onlineCount > 0 ? '0 0 20px rgba(34,197,94,0.2)' : undefined}
        />
        <KpiCard
          icon={<AlertTriangle size={18} color={criticalCount > 0 ? '#ef4444' : '#eab308'} />}
          iconBg={criticalCount > 0 ? 'rgba(239,68,68,0.1)' : 'rgba(234,179,8,0.1)'}
          iconBorder={criticalCount > 0 ? 'rgba(239,68,68,0.3)' : 'rgba(234,179,8,0.3)'}
          value={anomalies.length}
          label="Anomalías Activas"
          sub={criticalCount > 0 ? `${criticalCount} críticas` : 'sin críticas'}
          color={criticalCount > 0 ? '#ef4444' : '#eab308'}
          glow={criticalCount > 0 ? '0 0 20px rgba(239,68,68,0.3)' : undefined}
        />
        <KpiCard
          icon={<Activity size={18} color="#eab308" />}
          iconBg="rgba(234,179,8,0.1)"
          iconBorder="rgba(234,179,8,0.3)"
          value={stats.unresolved ?? 0}
          label="Sin Resolver"
          sub="eventos pendientes"
          color="#eab308"
        />
      </div>

      {/* Chart + Alerts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '14px' }}>
        {/* Traffic Chart */}
        <div className="panel">
          <div className="panel-header">
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Tráfico de Red — RX / TX (KB/s)
            </span>
            <div style={{ display: 'flex', gap: '16px' }}>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#06b6d4', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '8px', height: '2px', background: '#06b6d4', display: 'inline-block' }} /> RX
              </span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#22c55e', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '8px', height: '2px', background: '#22c55e', display: 'inline-block' }} /> TX
              </span>
            </div>
          </div>
          <div style={{ padding: '16px', height: '240px' }}>
            {chartData.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>
                Esperando datos de tráfico...
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="rx" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#06b6d4" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="tx" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#484f58', fontFamily: 'JetBrains Mono' }} />
                  <YAxis tick={{ fontSize: 10, fill: '#484f58', fontFamily: 'JetBrains Mono' }} />
                  <Tooltip contentStyle={{ background: '#161b22', border: '1px solid #30363d', borderRadius: '8px', fontFamily: 'JetBrains Mono', fontSize: '11px' }} />
                  <Area type="monotone" dataKey="rx" stroke="#06b6d4" fill="url(#rx)" strokeWidth={1.5} name="RX (KB)" />
                  <Area type="monotone" dataKey="tx" stroke="#22c55e" fill="url(#tx)" strokeWidth={1.5} name="TX (KB)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Live Alerts */}
        <div className="panel">
          <div className="panel-header">
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Alertas Live
            </span>
            <div className="dot-danger" />
          </div>
          <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '256px', overflowY: 'auto' }}>
            {liveAlerts.length === 0 ? (
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58', textAlign: 'center', padding: '24px 0' }}>
                Sin alertas recientes
              </div>
            ) : (
              liveAlerts.map((a, i) => (
                <div key={i} style={{ background: '#161b22', borderRadius: '6px', padding: '10px', border: '1px solid #30363d' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <span className={SEVERITY_BADGE[a.severity] ?? 'badge-info'}>{a.severity}</span>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58' }}>
                      {a.detectedAt ? format(new Date(a.detectedAt), 'HH:mm:ss') : '--:--:--'}
                    </span>
                  </div>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#e6edf3' }}>{a.anomalyType}</div>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58', marginTop: '2px' }}>
                    s{a.switchId}:{a.portId}{a.hostName ? ` — ${a.hostName}` : ''}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Switches Grid */}
      <div className="panel">
        <div className="panel-header">
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Switches en Red
          </span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>
            {switches.length} dispositivos
          </span>
        </div>
        <div style={{ padding: '16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px' }}>
          {switches.length === 0 ? (
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58', gridColumn: '1/-1', textAlign: 'center', padding: '20px' }}>
              Sin switches activos
            </div>
          ) : (
            switches.map(sw => {
              const isOnline = sw.active ?? sw.status === 'ONLINE'
              const isSpine  = sw.switchType === 'SPINE'
              return (
                <div key={sw.switchId ?? sw.id} style={{
                  background: isSpine ? 'rgba(6,182,212,0.04)' : 'rgba(34,197,94,0.04)',
                  border: `1px solid ${isSpine ? 'rgba(6,182,212,0.2)' : 'rgba(34,197,94,0.2)'}`,
                  borderRadius: '8px', padding: '12px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <div className={isOnline ? 'dot-online' : 'dot-offline'} />
                    <span className={isSpine ? 'badge-info' : 'badge-low'} style={{ fontSize: '10px' }}>
                      {sw.switchType}
                    </span>
                  </div>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: '#e6edf3', marginBottom: '2px' }}>
                    {sw.name ?? sw.switchId}
                  </div>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58' }}>
                    ID: {sw.switchId ?? sw.id}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

function KpiCard({ icon, iconBg, iconBorder, value, label, sub, color, glow }) {
  return (
    <div className="panel" style={{ padding: '16px', boxShadow: glow ?? '0 4px 24px rgba(0,0,0,0.4)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
        <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: iconBg, border: `1px solid ${iconBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {icon}
        </div>
      </div>
      <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: '28px', color, lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontSize: '13px', color: '#8b949e', marginTop: '4px' }}>{label}</div>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58', marginTop: '2px' }}>{sub}</div>
    </div>
  )
}
