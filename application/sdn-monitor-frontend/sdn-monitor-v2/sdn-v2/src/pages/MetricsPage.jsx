import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Loader2, TrendingUp } from 'lucide-react'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import {
  BarChart, Bar, AreaChart, Area, LineChart, Line,
  PieChart, Pie, Cell, RadialBarChart, RadialBar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid,
} from 'recharts'
import { topologyApi, metricsApi } from '../services/api'
import { formatBytes } from '../utils/format'

const TICK = { fontSize: 10, fill: '#484f58', fontFamily: 'JetBrains Mono, monospace' }
const TT   = {
  contentStyle: { background: '#161b22', border: '1px solid #30363d', borderRadius: '8px', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#e6edf3' },
  labelStyle: { color: '#8b949e' },
}
const PORT_COLORS   = ['#06b6d4', '#22c55e', '#f97316', '#818cf8']
const SWITCH_COLORS = ['#06b6d4', '#22d3ee', '#22c55e', '#4ade80', '#86efac']
const MINUTES_OPTIONS = [
  { value: 15,   label: '15 min' },
  { value: 30,   label: '30 min' },
  { value: 60,   label: '1 hora' },
  { value: 360,  label: '6 horas' },
  { value: 1440, label: '24 horas' },
]

const LABEL_SM = { fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.06em' }

function Empty({ text }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>
      {text}
    </div>
  )
}

export default function MetricsPage() {
  const [switches,     setSwitches]     = useState([])
  const [selectedSw,   setSelectedSw]   = useState('')
  const [minutes,      setMinutes]      = useState(30)
  const [metrics,      setMetrics]      = useState([])
  const [allMetrics,   setAllMetrics]   = useState({})   // switchId → latest metric
  const [loading,      setLoading]      = useState(false)
  const [swLoading,    setSwLoading]    = useState(true)

  // Load switches once
  useEffect(() => {
    topologyApi.getSwitches()
      .then(r => {
        const sws = r.data ?? []
        setSwitches(sws)
        if (sws.length > 0) setSelectedSw(String(sws[0].switchId ?? sws[0].id))
      })
      .catch(() => toast.error('Error cargando switches'))
      .finally(() => setSwLoading(false))
  }, [])

  // Load metrics for selected switch
  const load = useCallback(async () => {
    if (!selectedSw) return
    setLoading(true)
    try {
      const res = await metricsApi.getPortMetrics(selectedSw, minutes)
      setMetrics(res.data ?? [])
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error cargando métricas')
    } finally {
      setLoading(false)
    }
  }, [selectedSw, minutes])

  useEffect(() => { load() }, [load])

  // Load all switches latest metrics for pie chart
  useEffect(() => {
    if (switches.length === 0) return
    Promise.all(
      switches.map(sw =>
        metricsApi.getPortMetrics(sw.switchId ?? sw.id, 5)
          .then(r => ({ id: String(sw.switchId ?? sw.id), name: sw.name, data: r.data ?? [] }))
          .catch(() => ({ id: String(sw.switchId ?? sw.id), name: sw.name, data: [] }))
      )
    ).then(results => {
      const map = {}
      results.forEach(r => { map[r.id] = { name: r.name, data: r.data } })
      setAllMetrics(map)
    })
  }, [switches])

  // Derive stats from metrics array
  const latestByPort = {}
  metrics.forEach(m => {
    if (!latestByPort[m.portId] || new Date(m.timestamp) > new Date(latestByPort[m.portId].timestamp)) {
      latestByPort[m.portId] = m
    }
  })
  const portList   = Object.values(latestByPort)
  const totalRx    = portList.reduce((s, m) => s + (m.rxBytes ?? 0), 0)
  const totalTx    = portList.reduce((s, m) => s + (m.txBytes ?? 0), 0)
  const totalErr   = portList.reduce((s, m) => s + (m.rxErrors ?? 0) + (m.txErrors ?? 0), 0)
  const totalDrop  = portList.reduce((s, m) => s + (m.rxDropped ?? 0) + (m.txDropped ?? 0), 0)

  // Chart: bar rx/tx per port
  const portBarData = portList.map(m => ({
    name: `P${m.portId}`,
    RX: Math.round((m.rxBytes ?? 0) / 1024),
    TX: Math.round((m.txBytes ?? 0) / 1024),
  }))

  // Chart: time-series area by port (max 4 ports)
  const ports = [...new Set(metrics.map(m => m.portId))].slice(0, 4)
  const timeMap = {}
  metrics.forEach(m => {
    const t = format(new Date(m.timestamp), 'HH:mm')
    if (!timeMap[t]) timeMap[t] = { time: t }
    timeMap[t][`P${m.portId}`] = Math.round((m.rxBytes ?? 0) / 1024)
  })
  const timeData = Object.values(timeMap).slice(-30)

  // Chart: errors line
  const errorData = metrics
    .filter(m => m.portId === portList[0]?.portId)
    .slice(-30)
    .map(m => ({
      time: format(new Date(m.timestamp), 'HH:mm:ss'),
      rxErr: m.rxErrors ?? 0,
      txErr: m.txErrors ?? 0,
      rxDrop: m.rxDropped ?? 0,
      txDrop: m.txDropped ?? 0,
    }))
  const hasErrors = errorData.some(d => d.rxErr + d.txErr + d.rxDrop + d.txDrop > 0)

  // Chart: pie per switch
  const pieData = Object.entries(allMetrics).map(([id, { name, data }], i) => {
    const rx = data.reduce((s, m) => s + (m.rxBytes ?? 0), 0)
    return { name: name ?? `s${id}`, value: rx, color: SWITCH_COLORS[i % SWITCH_COLORS.length] }
  }).filter(d => d.value > 0)

  // Spine vs Leaf comparison
  const spines = switches.filter(s => s.switchType === 'SPINE')
  const leaves = switches.filter(s => s.switchType === 'LEAF')
  const sumRx = (sws) => sws.reduce((acc, sw) => {
    const id = String(sw.switchId ?? sw.id)
    const d  = allMetrics[id]?.data ?? []
    return acc + d.reduce((s, m) => s + (m.rxBytes ?? 0), 0)
  }, 0)
  const spineRx = sumRx(spines)
  const leafRx  = sumRx(leaves)
  const hasSpineLeaf = spineRx > 0 || leafRx > 0

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header */}
      <div>
        <h1 style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: '20px', color: '#e6edf3', marginBottom: '4px' }}>Métricas</h1>
        <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>{'>'} Análisis completo de tráfico de red por switch y puerto</p>
      </div>

      {/* Selector */}
      <div className="panel" style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div>
            <label style={{ display: 'block', fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '5px' }}>Switch</label>
            <select className="input" value={selectedSw} onChange={e => setSelectedSw(e.target.value)} style={{ width: '180px', cursor: 'pointer' }} disabled={swLoading}>
              {switches.map(sw => (
                <option key={sw.switchId ?? sw.id} value={String(sw.switchId ?? sw.id)}>
                  {sw.name ?? `Switch ${sw.switchId}`} [{sw.switchType}]
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '5px' }}>Ventana</label>
            <select className="input" value={minutes} onChange={e => setMinutes(Number(e.target.value))} style={{ width: '130px', cursor: 'pointer' }}>
              {MINUTES_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div style={{ marginTop: '18px' }}>
            <button className="btn-ghost" onClick={load} disabled={loading} style={{ gap: '6px' }}>
              {loading ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
              Actualizar
            </button>
          </div>
          {loading && (
            <div style={{ marginTop: '18px', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>
              Cargando...
            </div>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
        <MetricKpi label="RX Total"         value={formatBytes(totalRx)}  color="#06b6d4" sub="recibido" />
        <MetricKpi label="TX Total"         value={formatBytes(totalTx)}  color="#4ade80" sub="enviado" />
        <MetricKpi label="Errores RX+TX"    value={totalErr}              color={totalErr  > 0 ? '#f87171' : '#484f58'} sub="paquetes erróneos" />
        <MetricKpi label="Paquetes Perdidos" value={totalDrop}            color={totalDrop > 0 ? '#fb923c' : '#484f58'} sub="rx + tx dropped" />
      </div>

      {/* Charts 2x2 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
        {/* Bar: RX/TX per port */}
        <div className="panel">
          <div className="panel-header"><span style={LABEL_SM}>Tráfico RX/TX por Puerto (KB)</span></div>
          <div style={{ padding: '16px', height: '240px' }}>
            {portBarData.length === 0 ? <Empty text="Sin datos de puertos" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={portBarData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(48,54,61,0.5)" vertical={false} />
                  <XAxis dataKey="name" tick={TICK} />
                  <YAxis tick={TICK} />
                  <Tooltip {...TT} />
                  <Legend wrapperStyle={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#8b949e' }} />
                  <Bar dataKey="RX" fill="#06b6d4" radius={[3,3,0,0]} />
                  <Bar dataKey="TX" fill="#22c55e" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Area: RX evolution per port */}
        <div className="panel">
          <div className="panel-header"><span style={LABEL_SM}>Evolución RX por Puerto (KB)</span></div>
          <div style={{ padding: '16px', height: '240px' }}>
            {timeData.length === 0 ? <Empty text="Sin histórico disponible" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timeData}>
                  <defs>
                    {ports.map((p, i) => (
                      <linearGradient key={p} id={`gp${p}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={PORT_COLORS[i]} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={PORT_COLORS[i]} stopOpacity={0} />
                      </linearGradient>
                    ))}
                  </defs>
                  <XAxis dataKey="time" tick={TICK} />
                  <YAxis tick={TICK} />
                  <Tooltip {...TT} />
                  <Legend wrapperStyle={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#8b949e' }} />
                  {ports.map((p, i) => (
                    <Area key={p} type="monotone" dataKey={`P${p}`} stroke={PORT_COLORS[i]} fill={`url(#gp${p})`} strokeWidth={1.5} name={`Puerto ${p}`} />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Line: errors */}
        <div className="panel">
          <div className="panel-header"><span style={LABEL_SM}>Errores y Drops</span></div>
          <div style={{ padding: '16px', height: '240px' }}>
            {!hasErrors
              ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '8px' }}>
                  <TrendingUp size={24} color="#4ade80" />
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: '#4ade80' }}>Sin errores detectados ✓</span>
                </div>
              )
              : errorData.length === 0 ? <Empty text="Sin datos de errores" /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={errorData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(48,54,61,0.5)" vertical={false} />
                    <XAxis dataKey="time" tick={TICK} />
                    <YAxis tick={TICK} />
                    <Tooltip {...TT} />
                    <Legend wrapperStyle={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#8b949e' }} />
                    <Line type="monotone" dataKey="rxErr"  stroke="#ef4444" dot={false} strokeWidth={1.5} name="RX Errors" />
                    <Line type="monotone" dataKey="txErr"  stroke="#f97316" dot={false} strokeWidth={1.5} name="TX Errors" />
                    <Line type="monotone" dataKey="rxDrop" stroke="#eab308" dot={false} strokeWidth={1.5} name="RX Dropped" />
                    <Line type="monotone" dataKey="txDrop" stroke="#818cf8" dot={false} strokeWidth={1.5} name="TX Dropped" />
                  </LineChart>
                </ResponsiveContainer>
              )
            }
          </div>
        </div>

        {/* Pie: traffic per switch */}
        <div className="panel">
          <div className="panel-header"><span style={LABEL_SM}>Distribución de Tráfico por Switch</span></div>
          <div style={{ padding: '16px', height: '240px' }}>
            {pieData.length === 0 ? <Empty text="Sin datos de switches" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} cx="45%" cy="50%" outerRadius={80} dataKey="value" nameKey="name" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={{ stroke: '#30363d' }}>
                    {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip {...TT} formatter={v => formatBytes(v)} />
                  <Legend wrapperStyle={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#8b949e' }} formatter={(v, e) => `${v}: ${formatBytes(e.payload.value)}`} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Detailed table */}
      <div className="panel">
        <div className="panel-header">
          <span style={LABEL_SM}>Métricas Detalladas por Puerto — {switches.find(s => String(s.switchId ?? s.id) === selectedSw)?.name ?? selectedSw}</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #30363d' }}>
                {['Puerto', 'RX Bytes', 'TX Bytes', 'RX Pkts', 'TX Pkts', 'RX Err', 'TX Err', 'RX Drop', 'TX Drop', 'Timestamp'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 400, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {portList.length === 0 ? (
                <tr><td colSpan={10} style={{ padding: '28px', textAlign: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>Sin métricas disponibles</td></tr>
              ) : (
                <>
                  {portList.map(m => (
                    <tr key={m.portId} style={{ borderBottom: '1px solid rgba(48,54,61,0.5)', transition: 'background 0.15s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(28,35,51,0.5)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={MONO_CELL('#22d3ee')}>P{m.portId}</td>
                      <td style={MONO_CELL()}>{formatBytes(m.rxBytes)}</td>
                      <td style={MONO_CELL()}>{formatBytes(m.txBytes)}</td>
                      <td style={MONO_CELL()}>{(m.rxPackets ?? 0).toLocaleString()}</td>
                      <td style={MONO_CELL()}>{(m.txPackets ?? 0).toLocaleString()}</td>
                      <td style={MONO_CELL((m.rxErrors ?? 0) > 0 ? '#f87171' : '#484f58')}>{m.rxErrors ?? 0}</td>
                      <td style={MONO_CELL((m.txErrors ?? 0) > 0 ? '#f87171' : '#484f58')}>{m.txErrors ?? 0}</td>
                      <td style={MONO_CELL((m.rxDropped ?? 0) > 0 ? '#fb923c' : '#484f58')}>{m.rxDropped ?? 0}</td>
                      <td style={MONO_CELL((m.txDropped ?? 0) > 0 ? '#fb923c' : '#484f58')}>{m.txDropped ?? 0}</td>
                      <td style={MONO_CELL('#484f58')}>{m.timestamp ? format(new Date(m.timestamp), 'HH:mm:ss') : '—'}</td>
                    </tr>
                  ))}
                  {/* Totals row */}
                  <tr style={{ background: 'rgba(28,35,51,0.6)', borderTop: '1px solid #30363d', fontWeight: 700 }}>
                    <td style={MONO_CELL('#e6edf3')}>TOTAL</td>
                    <td style={MONO_CELL('#06b6d4')}>{formatBytes(totalRx)}</td>
                    <td style={MONO_CELL('#4ade80')}>{formatBytes(totalTx)}</td>
                    <td style={MONO_CELL()}>—</td>
                    <td style={MONO_CELL()}>—</td>
                    <td style={MONO_CELL(totalErr  > 0 ? '#f87171' : '#484f58')}>{totalErr}</td>
                    <td style={MONO_CELL()}>—</td>
                    <td style={MONO_CELL(totalDrop > 0 ? '#fb923c' : '#484f58')}>{totalDrop}</td>
                    <td style={MONO_CELL()}>—</td>
                    <td style={MONO_CELL()}>—</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Spine vs Leaf comparison */}
      {hasSpineLeaf && (
        <div className="panel">
          <div className="panel-header">
            <span style={LABEL_SM}>Comparativa Spine vs Leaf — RX Total</span>
            {(spineRx + leafRx) > 0 && (
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58' }}>
                Diferencia: {Math.abs(Math.round((spineRx - leafRx) / (spineRx + leafRx) * 100))}%
              </span>
            )}
          </div>
          <div style={{ padding: '16px', height: '200px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[{ name: 'SPINE', rx: Math.round(spineRx / 1024) }, { name: 'LEAF', rx: Math.round(leafRx / 1024) }]}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(48,54,61,0.5)" vertical={false} />
                <XAxis dataKey="name" tick={TICK} />
                <YAxis tick={TICK} />
                <Tooltip {...TT} formatter={v => `${v} KB`} />
                <Bar dataKey="rx" name="RX (KB)" radius={[4,4,0,0]}>
                  <Cell fill="#06b6d4" />
                  <Cell fill="#22c55e" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}

const MONO_CELL = (color) => ({
  padding: '10px 14px',
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: '11px',
  color: color ?? '#e6edf3',
  whiteSpace: 'nowrap',
})

function MetricKpi({ label, value, color, sub }) {
  return (
    <div className="stat-card">
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '9px', color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px' }}>{label}</div>
      <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: '22px', color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58', marginTop: '4px' }}>{sub}</div>
    </div>
  )
}
