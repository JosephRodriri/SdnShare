import { useState, useEffect, useCallback } from 'react'
import { Server, Monitor } from 'lucide-react'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { topologyApi } from '../services/api'

function SwitchNode({ sw, selected, onClick }) {
  const isSpine = sw.switchType === 'SPINE'
  const isOnline = sw.active ?? sw.status === 'ONLINE'
  return (
    <div
      onClick={() => onClick(sw)}
      style={{
        background: isSpine ? 'rgba(6,182,212,0.05)' : 'rgba(34,197,94,0.05)',
        border: `1px solid ${selected ? (isSpine ? 'rgba(6,182,212,0.7)' : 'rgba(34,197,94,0.7)') : (isSpine ? 'rgba(6,182,212,0.3)' : 'rgba(34,197,94,0.3)')}`,
        borderRadius: '10px', padding: '12px 16px', cursor: 'pointer',
        transition: 'all 0.2s',
        boxShadow: selected ? (isSpine ? '0 0 20px rgba(6,182,212,0.3)' : '0 0 20px rgba(34,197,94,0.3)') : 'none',
        minWidth: '130px', textAlign: 'center',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '6px' }}>
        <Server size={20} color={isSpine ? '#06b6d4' : '#22c55e'} />
      </div>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: '#e6edf3', marginBottom: '4px' }}>
        {sw.name ?? sw.switchId}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', alignItems: 'center' }}>
        <span className={isSpine ? 'badge-info' : 'badge-low'} style={{ fontSize: '10px' }}>{sw.switchType}</span>
        <div className={isOnline ? 'dot-online' : 'dot-offline'} />
      </div>
    </div>
  )
}

function HostNode({ host }) {
  const isOnline = host.active ?? host.status === 'ONLINE'
  return (
    <div style={{
      border: '1px solid #30363d', borderRadius: '8px', padding: '8px 10px',
      background: '#161b22', textAlign: 'center', minWidth: '90px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '4px' }}>
        <Monitor size={14} color="#484f58" />
      </div>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#e6edf3' }}>
        {host.hostName ?? host.name}
      </div>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58' }}>
        {host.ipv4 ?? host.ip}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: '4px' }}>
        <div className={isOnline ? 'dot-online' : 'dot-offline'} />
      </div>
    </div>
  )
}

export default function TopologyPage() {
  const [switches, setSwitches] = useState([])
  const [hosts,    setHosts]    = useState([])
  const [loading,  setLoading]  = useState(true)
  const [selected, setSelected] = useState(null)

  const load = useCallback(async () => {
    try {
      const [swRes, hRes] = await Promise.all([
        topologyApi.getSwitches(),
        topologyApi.getHosts(),
      ])
      setSwitches(swRes.data ?? [])
      setHosts(hRes.data ?? [])
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error cargando topología')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const spines = switches.filter(s => s.switchType === 'SPINE')
  const leaves = switches.filter(s => s.switchType === 'LEAF')

  const hostsForLeaf = (leafName) => {
    const sw = switches.find(s => s.name === leafName)
    if (!sw) return []
    return hosts.filter(h => h.connectedSwitch === sw.switchId)
  }

  const handleSelect = (sw) => {
    setSelected(prev => prev?.switchId === sw.switchId ? null : sw)
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: '#484f58' }}>
          Cargando topología...
        </div>
      </div>
    )
  }

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: '20px', color: '#e6edf3', marginBottom: '4px' }}>
          Topología de Red
        </h1>
        <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>
          {'>'} Arquitectura Spine-Leaf — {switches.length} switches, {hosts.length} hosts
        </p>
      </div>

      {/* Topology Diagram */}
      <div className="panel">
        <div className="panel-header">
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Diagrama Topológico
          </span>
        </div>
        <div style={{ padding: '24px' }}>
          {/* Spine layer */}
          <div style={{ textAlign: 'center', marginBottom: '16px' }}>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#06b6d4', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px' }}>
              — CAPA SPINE —
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', flexWrap: 'wrap' }}>
              {spines.map(sw => (
                <SwitchNode key={sw.switchId} sw={sw} selected={selected?.switchId === sw.switchId} onClick={handleSelect} />
              ))}
              {spines.length === 0 && (
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>Sin switches spine</div>
              )}
            </div>
          </div>

          {/* Connector lines */}
          <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}>
            <div style={{
              width: '2px', height: '32px',
              background: 'linear-gradient(to bottom, rgba(6,182,212,0.5), rgba(34,197,94,0.5))'
            }} />
          </div>

          {/* Leaf + Hosts layer */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#22c55e', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px' }}>
              — CAPA LEAF —
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '24px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {leaves.map(sw => {
                const leafHosts = hostsForLeaf(sw.name)
                return (
                  <div key={sw.switchId} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                    <SwitchNode sw={sw} selected={selected?.switchId === sw.switchId} onClick={handleSelect} />
                    {leafHosts.length > 0 && (
                      <>
                        <div style={{ width: '1px', height: '12px', background: 'rgba(48,54,61,0.8)' }} />
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                          {leafHosts.map(h => <HostNode key={h.hostId ?? h.mac} host={h} />)}
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
              {leaves.length === 0 && (
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>Sin switches leaf</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Selected switch detail */}
      {selected && (
        <div className="panel">
          <div className="panel-header">
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Detalle — {selected.name ?? selected.switchId}
            </span>
            <button onClick={() => setSelected(null)} className="btn-ghost" style={{ padding: '4px 10px', fontSize: '11px' }}>✕</button>
          </div>
          <div style={{ padding: '16px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
            {[
              ['SWITCH ID', selected.switchId],
              ['TIPO', selected.switchType],
              ['ESTADO', selected.active ? 'ONLINE' : 'OFFLINE'],
              ['ÚLTIMO VISTO', selected.lastSeen ? format(new Date(selected.lastSeen), 'dd/MM HH:mm') : 'N/A'],
            ].map(([label, val]) => (
              <div key={label} style={{ background: '#161b22', borderRadius: '6px', padding: '12px' }}>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>{label}</div>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '13px', color: '#e6edf3' }}>{val}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hosts table */}
      <div className="panel">
        <div className="panel-header">
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Hosts
          </span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>
            {hosts.length} dispositivos
          </span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #30363d' }}>
                {['Host', 'IP', 'MAC', 'Switch', 'Puerto', 'Estado'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 400 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hosts.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '24px', textAlign: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>
                    Sin hosts registrados
                  </td>
                </tr>
              ) : (
                hosts.map(h => (
                  <tr key={h.hostId ?? h.mac} style={{ borderBottom: '1px solid rgba(48,54,61,0.5)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(28,35,51,0.5)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '10px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: '#22d3ee' }}>
                      {h.hostName ?? h.name}
                    </td>
                    <td style={{ padding: '10px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: '#e6edf3' }}>
                      {h.ipv4 ?? h.ip ?? '—'}
                    </td>
                    <td style={{ padding: '10px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>
                      {h.mac ?? '—'}
                    </td>
                    <td style={{ padding: '10px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: '#8b949e' }}>
                      {h.connectedSwitch ?? '—'}
                    </td>
                    <td style={{ padding: '10px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: '#8b949e' }}>
                      {h.port ?? '—'}
                    </td>
                    <td style={{ padding: '10px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div className={(h.active ?? h.status === 'ONLINE') ? 'dot-online' : 'dot-offline'} />
                        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: (h.active ?? h.status === 'ONLINE') ? '#22c55e' : '#484f58' }}>
                          {(h.active ?? h.status === 'ONLINE') ? 'Online' : 'Offline'}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
