import { useState, useEffect, useCallback } from 'react'
import { Server, Monitor } from 'lucide-react'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { topologyApi, metricsApi, anomaliesApi } from '../services/api'
import { formatBytes } from '../utils/format'

const TICK = { fontSize: 10, fill: '#484f58', fontFamily: 'JetBrains Mono, monospace' }
const TT   = { contentStyle: { background: '#161b22', border: '1px solid #30363d', borderRadius: '8px', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#e6edf3' }, labelStyle: { color: '#8b949e' } }
const LABEL_SM = { fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.06em' }

function SwitchNode({ sw, selected, onClick }) {
  const isSpine  = sw.switchType === 'SPINE'
  const isOnline = sw.active ?? sw.status === 'ONLINE'
  const [hov, setHov] = useState(false)
  return (
    <div
      onClick={() => onClick(sw)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: isSpine ? 'rgba(6,182,212,0.05)' : 'rgba(34,197,94,0.05)',
        border: `1px solid ${selected ? (isSpine ? 'rgba(6,182,212,0.8)' : 'rgba(34,197,94,0.8)') : (isSpine ? 'rgba(6,182,212,0.25)' : 'rgba(34,197,94,0.25)')}`,
        borderRadius: '10px', padding: '14px 18px', cursor: 'pointer',
        transition: 'all 0.2s', minWidth: '130px', textAlign: 'center',
        boxShadow: selected ? (isSpine ? '0 0 24px rgba(6,182,212,0.35)' : '0 0 24px rgba(34,197,94,0.35)') : hov ? (isSpine ? '0 0 14px rgba(6,182,212,0.2)' : '0 0 14px rgba(34,197,94,0.2)') : 'none',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '7px' }}>
        <Server size={20} color={isSpine ? '#06b6d4' : '#22c55e'} />
      </div>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: '#e6edf3', marginBottom: '5px' }}>
        {sw.name ?? `s${sw.switchId}`}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', alignItems: 'center' }}>
        <span className={isSpine ? 'badge-info' : 'badge-low'} style={{ fontSize: '10px' }}>{sw.switchType}</span>
        <div className={isOnline ? 'dot-online' : 'dot-offline'} />
      </div>
    </div>
  )
}

function HostNode({ host, hasAnomaly }) {
  const isOnline = host.active ?? host.status === 'ONLINE'
  return (
    <div style={{
      border: `1px solid ${hasAnomaly ? 'rgba(239,68,68,0.6)' : '#30363d'}`,
      borderRadius: '8px', padding: '9px 11px',
      background: hasAnomaly ? 'rgba(239,68,68,0.05)' : '#161b22',
      textAlign: 'center', minWidth: '90px',
      boxShadow: hasAnomaly ? '0 0 10px rgba(239,68,68,0.2)' : 'none',
      animation: hasAnomaly ? 'pulse 2s ease-in-out infinite' : 'none',
    }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '4px' }}>
        <Monitor size={14} color={hasAnomaly ? '#f87171' : '#484f58'} />
      </div>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#e6edf3' }}>
        {host.hostName ?? host.name}
      </div>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58' }}>
        {host.ipv4 ?? host.ip ?? '—'}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: '4px' }}>
        <div className={isOnline ? 'dot-online' : 'dot-offline'} />
      </div>
    </div>
  )
}

// Heat map cell
function HeatCell({ label, bytes, hasAnomaly }) {
  const kb = (bytes ?? 0) / 1024
  const bg = hasAnomaly || kb > 1024
    ? 'rgba(239,68,68,0.15)'
    : kb > 512
      ? 'rgba(234,179,8,0.15)'
      : 'rgba(34,197,94,0.1)'
  const border = hasAnomaly || kb > 1024
    ? 'rgba(239,68,68,0.4)'
    : kb > 512 ? 'rgba(234,179,8,0.4)' : 'rgba(34,197,94,0.3)'
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: '6px', padding: '10px', textAlign: 'center', minWidth: '90px' }}>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#8b949e', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: hasAnomaly || kb > 1024 ? '#f87171' : kb > 512 ? '#facc15' : '#4ade80' }}>
        {formatBytes(bytes ?? 0)}
      </div>
    </div>
  )
}

export default function TopologyPage() {
  const [switches,   setSwitches]   = useState([])
  const [hosts,      setHosts]      = useState([])
  const [anomalies,  setAnomalies]  = useState([])
  const [metrics,    setMetrics]    = useState({})   // switchId → portMetrics[]
  const [selected,   setSelected]   = useState(null)
  const [swMetrics,  setSwMetrics]  = useState([])
  const [loading,    setLoading]    = useState(true)

  const load = useCallback(async () => {
    try {
      const [swRes, hRes, anRes] = await Promise.all([
        topologyApi.getSwitches(),
        topologyApi.getHosts(),
        anomaliesApi.getAll(true),
      ])
      setSwitches(swRes.data ?? [])
      setHosts(hRes.data ?? [])
      setAnomalies(anRes.data ?? [])
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error cargando topología')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Load metrics for all switches (for heat map)
  useEffect(() => {
    if (switches.length === 0) return
    Promise.all(
      switches.map(sw =>
        metricsApi.getPortMetrics(sw.switchId ?? sw.id, 5)
          .then(r => ({ id: String(sw.switchId ?? sw.id), data: r.data ?? [] }))
          .catch(() => ({ id: String(sw.switchId ?? sw.id), data: [] }))
      )
    ).then(results => {
      const map = {}
      results.forEach(r => { map[r.id] = r.data })
      setMetrics(map)
    })
  }, [switches])

  // When switch is selected, load its metrics
  useEffect(() => {
    if (!selected) return
    metricsApi.getPortMetrics(selected.switchId ?? selected.id, 15)
      .then(r => setSwMetrics(r.data ?? []))
      .catch(() => setSwMetrics([]))
  }, [selected])

  const spines = switches.filter(s => s.switchType === 'SPINE')
  const leaves = switches.filter(s => s.switchType === 'LEAF')

  const hostsForLeaf = (sw) =>
    hosts.filter(h => h.connectedSwitch === (sw.switchId ?? sw.id))

  const affectedHosts = new Set(anomalies.map(a => a.hostName).filter(Boolean))

  const handleSelect = (sw) => {
    setSelected(prev => prev?.switchId === sw.switchId ? null : sw)
    setSwMetrics([])
  }

  // Mini bar chart for selected switch
  const latestByPort = {}
  swMetrics.forEach(m => {
    if (!latestByPort[m.portId] || new Date(m.timestamp) > new Date(latestByPort[m.portId].timestamp)) {
      latestByPort[m.portId] = m
    }
  })
  const miniBarData = Object.values(latestByPort).map(m => ({
    name: `P${m.portId}`,
    RX: Math.round((m.rxBytes ?? 0) / 1024),
    TX: Math.round((m.txBytes ?? 0) / 1024),
  }))

  // Selected switch active anomalies
  const swAnomalies = anomalies.filter(a => String(a.switchId) === String(selected?.switchId ?? selected?.id))

  // Heat map: one cell per switch, show total rx bytes
  const heatData = switches.map(sw => {
    const id  = String(sw.switchId ?? sw.id)
    const mArr = metrics[id] ?? []
    const rx  = mArr.reduce((s, m) => s + (m.rxBytes ?? 0), 0)
    const hasAnom = anomalies.some(a => String(a.switchId) === id)
    return { name: sw.name ?? `s${id}`, rx, hasAnom }
  })

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: '#484f58' }}>Cargando topología...</span>
    </div>
  )

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: '20px', color: '#e6edf3', marginBottom: '4px' }}>Topología de Red</h1>
        <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>{'>'} Arquitectura Spine-Leaf — {switches.length} switches, {hosts.length} hosts</p>
      </div>

      {/* Diagram */}
      <div className="panel">
        <div className="panel-header"><span style={LABEL_SM}>Diagrama Topológico Interactivo</span><span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58' }}>Click en switch para detalles</span></div>
        <div style={{ padding: '28px 24px', position: 'relative' }}>
          {/* Spine layer */}
          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#06b6d4', textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: '14px' }}>
              — CAPA SPINE —
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', flexWrap: 'wrap' }}>
              {spines.map(sw => <SwitchNode key={sw.switchId} sw={sw} selected={selected?.switchId === sw.switchId} onClick={handleSelect} />)}
              {spines.length === 0 && <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>Sin switches spine</span>}
            </div>
          </div>

          {/* Interconnect line */}
          <div style={{ textAlign: 'center', margin: '8px 0 16px' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '60px', height: '1px', backgroundImage: 'repeating-linear-gradient(90deg, rgba(6,182,212,0.4) 0, rgba(6,182,212,0.4) 6px, transparent 6px, transparent 12px)' }} />
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '9px', color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.1em' }}>INTERCONEXIÓN SPINE-LEAF</span>
              <div style={{ width: '60px', height: '1px', backgroundImage: 'repeating-linear-gradient(90deg, rgba(6,182,212,0.4) 0, rgba(6,182,212,0.4) 6px, transparent 6px, transparent 12px)' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '4px' }}>
              <div style={{ width: '2px', height: '20px', background: 'linear-gradient(to bottom, rgba(6,182,212,0.5), rgba(34,197,94,0.5))' }} />
            </div>
          </div>

          {/* Leaf + Hosts */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#22c55e', textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: '14px' }}>
              — CAPA LEAF —
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '28px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {leaves.map(sw => {
                const leafHosts = hostsForLeaf(sw)
                const swAnomaly = anomalies.some(a => String(a.switchId) === String(sw.switchId ?? sw.id))
                return (
                  <div key={sw.switchId} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                    <SwitchNode sw={sw} selected={selected?.switchId === sw.switchId} onClick={handleSelect} />
                    {leafHosts.length > 0 && (
                      <>
                        <div style={{ width: '1px', height: '14px', background: 'rgba(48,54,61,0.8)' }} />
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                          {leafHosts.map(h => (
                            <HostNode key={h.hostId ?? h.mac ?? h.hostName} host={h} hasAnomaly={affectedHosts.has(h.hostName ?? h.name)} />
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
              {leaves.length === 0 && <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>Sin switches leaf</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Selected switch detail */}
      {selected && (
        <div className="panel animate-fade-in">
          <div className="panel-header">
            <span style={LABEL_SM}>Detalle — {selected.name ?? `s${selected.switchId}`}</span>
            <button onClick={() => setSelected(null)} className="btn-ghost" style={{ padding: '4px 10px', fontSize: '11px' }}>✕ Cerrar</button>
          </div>
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Info grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px' }}>
              {[
                ['Nombre',      selected.name ?? '—'],
                ['Switch ID',   selected.switchId ?? selected.id],
                ['Tipo',        selected.switchType ?? '—'],
                ['Estado',      (selected.active ?? selected.status === 'ONLINE') ? 'ONLINE' : 'OFFLINE'],
                ['Último visto', selected.lastSeen ? format(new Date(selected.lastSeen), 'dd/MM HH:mm') : 'N/A'],
              ].map(([l, v]) => (
                <div key={l} style={{ background: '#161b22', borderRadius: '6px', padding: '10px' }}>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '9px', color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>{l}</div>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: '#e6edf3' }}>{String(v)}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              {/* Mini bar chart */}
              <div>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
                  Tráfico por Puerto (KB)
                </div>
                <div style={{ height: '140px' }}>
                  {miniBarData.length === 0
                    ? <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>Sin datos</div>
                    : (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={miniBarData}>
                          <XAxis dataKey="name" tick={TICK} />
                          <YAxis tick={TICK} />
                          <Tooltip {...TT} />
                          <Bar dataKey="RX" fill="#06b6d4" radius={[2,2,0,0]} />
                          <Bar dataKey="TX" fill="#22c55e" radius={[2,2,0,0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    )
                  }
                </div>
              </div>

              {/* Active anomalies */}
              <div>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
                  Anomalías Activas ({swAnomalies.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '140px', overflowY: 'auto' }}>
                  {swAnomalies.length === 0
                    ? <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#4ade80' }}>✓ Sin anomalías activas</div>
                    : swAnomalies.map(a => (
                      <div key={a.id} style={{ background: '#161b22', borderRadius: '5px', padding: '7px 10px', borderLeft: '2px solid #ef4444', display: 'flex', justifyContent: 'space-between' }}>
                        <span className="badge-critical" style={{ fontSize: '10px' }}>{a.severity}</span>
                        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#8b949e' }}>{a.anomalyType}</span>
                        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58' }}>P{a.portId}</span>
                      </div>
                    ))
                  }
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Heat map */}
      <div className="panel">
        <div className="panel-header"><span style={LABEL_SM}>Mapa de Calor — Tráfico por Switch</span></div>
        <div style={{ padding: '16px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {heatData.length === 0
            ? <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>Sin datos de tráfico</span>
            : heatData.map((d, i) => <HeatCell key={i} label={d.name} bytes={d.rx} hasAnomaly={d.hasAnom} />)
          }
          <div style={{ display: 'flex', gap: '14px', alignItems: 'center', marginLeft: 'auto' }}>
            {[['#4ade80', 'Normal'], ['#facc15', '>512 KB'], ['#f87171', '>1 MB / Ataque']].map(([c, l]) => (
              <span key={l} style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: c, display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '8px', height: '8px', background: c, borderRadius: '2px', display: 'inline-block', opacity: 0.7 }} /> {l}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Hosts table */}
      <div className="panel">
        <div className="panel-header">
          <span style={LABEL_SM}>Hosts</span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>{hosts.length} dispositivos</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #30363d' }}>
                {['Host', 'IP', 'MAC', 'Switch', 'Puerto', 'Estado', 'Tráfico RX', 'Tráfico TX'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 400, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hosts.length === 0
                ? <tr><td colSpan={8} style={{ padding: '24px', textAlign: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>Sin hosts registrados</td></tr>
                : hosts.map(h => {
                  const isOnline   = h.active ?? h.status === 'ONLINE'
                  const hasAnomaly = affectedHosts.has(h.hostName ?? h.name)
                  const swId = String(h.connectedSwitch ?? '')
                  const swMetricsArr = metrics[swId] ?? []
                  const portM = swMetricsArr.find(m => String(m.portId) === String(h.port)) ?? null
                  return (
                    <tr key={h.hostId ?? h.mac ?? h.hostName} style={{ borderBottom: '1px solid rgba(48,54,61,0.5)', background: hasAnomaly ? 'rgba(239,68,68,0.03)' : 'transparent', transition: 'background 0.15s' }}
                      onMouseEnter={e => !hasAnomaly && (e.currentTarget.style.background = 'rgba(28,35,51,0.5)')}
                      onMouseLeave={e => e.currentTarget.style.background = hasAnomaly ? 'rgba(239,68,68,0.03)' : 'transparent'}
                    >
                      <td style={{ padding: '10px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: hasAnomaly ? '#f87171' : '#22d3ee' }}>{h.hostName ?? h.name}</td>
                      <td style={{ padding: '10px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#e6edf3' }}>{h.ipv4 ?? h.ip ?? '—'}</td>
                      <td style={{ padding: '10px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>{h.mac ?? '—'}</td>
                      <td style={{ padding: '10px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#8b949e' }}>{h.connectedSwitch ?? '—'}</td>
                      <td style={{ padding: '10px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#8b949e' }}>{h.port ?? '—'}</td>
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <div className={isOnline ? 'dot-online' : 'dot-offline'} />
                          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: isOnline ? '#4ade80' : '#484f58' }}>{isOnline ? 'Online' : 'Offline'}</span>
                        </div>
                      </td>
                      <td style={{ padding: '10px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#06b6d4' }}>{portM ? formatBytes(portM.rxBytes) : '—'}</td>
                      <td style={{ padding: '10px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#22c55e' }}>{portM ? formatBytes(portM.txBytes) : '—'}</td>
                    </tr>
                  )
                })
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
