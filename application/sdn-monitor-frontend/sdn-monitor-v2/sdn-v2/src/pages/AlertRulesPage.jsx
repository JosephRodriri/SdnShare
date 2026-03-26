import { useState, useEffect, useCallback } from 'react'
import { Plus, Edit, Trash2, ToggleLeft, ToggleRight, X, Loader2, Bell } from 'lucide-react'
import toast from 'react-hot-toast'
import { alertRulesApi } from '../services/api'
import { useRole } from '../hooks/useRole'

const LABEL_SM = { fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.06em' }
const METRIC_OPTIONS  = ['rx_pps', 'tx_pps', 'rx_bytes', 'tx_bytes', 'tx_errors', 'rx_errors']
const OPERATOR_OPTIONS = ['>', '<', '>=', '<=']
const SEVERITY_OPTIONS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
const APPLIES_OPTIONS  = ['ALL', 'SPINE', 'LEAF', 'HOST']
const SBADGE = { CRITICAL: 'badge-critical', HIGH: 'badge-high', MEDIUM: 'badge-medium', LOW: 'badge-low' }

const EMPTY_FORM = { name: '', description: '', metricType: 'rx_pps', operator: '>', threshold: '', durationSec: '', severity: 'MEDIUM', appliesTo: 'ALL' }

// ── Modal ─────────────────────────────────────────────────────────────────────
function RuleModal({ rule, onClose, onSaved }) {
  const [form, setForm]     = useState(rule ? { ...rule } : { ...EMPTY_FORM })
  const [loading, setLoading] = useState(false)
  const [errors, setErrors]   = useState({})

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const validate = () => {
    const e = {}
    if (!form.name.trim())      e.name      = 'Requerido'
    if (!form.threshold)        e.threshold  = 'Requerido'
    if (!form.durationSec)      e.durationSec = 'Requerido'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = async (ev) => {
    ev.preventDefault()
    if (!validate()) return
    setLoading(true)
    try {
      const payload = { ...form, threshold: Number(form.threshold), durationSec: Number(form.durationSec) }
      if (rule?.id) {
        await alertRulesApi.update(rule.id, payload)
        toast.success('Regla actualizada')
      } else {
        await alertRulesApi.create(payload)
        toast.success('Regla creada')
      }
      onSaved()
      onClose()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error al guardar regla')
    } finally {
      setLoading(false)
    }
  }

  const Field = ({ label, name, type = 'text', placeholder, options }) => (
    <div>
      <label style={{ display: 'block', fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '5px' }}>{label}</label>
      {options
        ? (
          <select className="input" value={form[name]} onChange={e => set(name, e.target.value)} style={{ cursor: 'pointer' }}>
            {options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        )
        : <input className="input" type={type} placeholder={placeholder} value={form[name]} onChange={e => set(name, e.target.value)} />
      }
      {errors[name] && <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#f87171', marginTop: '3px' }}>{errors[name]}</div>}
    </div>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(8,11,15,0.85)', backdropFilter: 'blur(4px)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', overflowY: 'auto' }}>
      <div className="panel animate-fade-in" style={{ width: '100%', maxWidth: '520px' }}>
        <div className="panel-header">
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: '#e6edf3' }}>
            {rule ? `Editar Regla — ${rule.name}` : 'Nueva Regla de Alerta'}
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#484f58' }}><X size={16} /></button>
        </div>
        <div style={{ padding: '8px 20px', borderBottom: '1px solid #30363d', background: 'rgba(6,182,212,0.03)' }}>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58' }}>ADMIN_PANEL — CREAR_REGLA_ALERTA</span>
        </div>
        <form onSubmit={handleSubmit} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={{ gridColumn: '1/-1' }}>
              <Field label="Nombre" name="name" placeholder="ej: DDoS Crítico Spine" />
            </div>
            <div style={{ gridColumn: '1/-1' }}>
              <Field label="Descripción" name="description" placeholder="Descripción de la regla..." />
            </div>
            <Field label="Métrica" name="metricType" options={METRIC_OPTIONS} />
            <Field label="Operador" name="operator" options={OPERATOR_OPTIONS} />
            <Field label="Umbral" name="threshold" type="number" placeholder="ej: 1000" />
            <Field label="Duración antes de alertar (seg)" name="durationSec" type="number" placeholder="ej: 30" />
            <Field label="Severidad" name="severity" options={SEVERITY_OPTIONS} />
            <Field label="Aplica a" name="appliesTo" options={APPLIES_OPTIONS} />
          </div>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '4px' }}>
            <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? <Loader2 size={13} className="spin" /> : <Bell size={13} />}
              {rule ? 'Guardar Cambios' : 'Crear Regla'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AlertRulesPage() {
  const { isAdmin } = useRole()
  const [rules,   setRules]   = useState([])
  const [loading, setLoading] = useState(true)
  const [modal,   setModal]   = useState(false)
  const [editing, setEditing] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await alertRulesApi.getAll()
      setRules(res.data ?? [])
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error cargando reglas')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleToggle = async (rule) => {
    try {
      await alertRulesApi.toggle(rule.id)
      toast.success(`Regla ${rule.enabled ? 'desactivada' : 'activada'}`)
      load()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error al cambiar estado')
    }
  }

  const handleDelete = async (rule) => {
    if (!window.confirm(`¿Eliminar regla "${rule.name}"?`)) return
    try {
      await alertRulesApi.delete(rule.id)
      toast.success('Regla eliminada')
      load()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error al eliminar')
    }
  }

  const openCreate = () => { setEditing(null); setModal(true) }
  const openEdit   = (r)  => { setEditing(r);   setModal(true) }
  const closeModal = ()   => { setModal(false);  setEditing(null) }

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: '20px', color: '#e6edf3', marginBottom: '4px' }}>Reglas de Alerta</h1>
          <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>{'>'} Configuración de umbrales y alertas automáticas</p>
        </div>
        {isAdmin && (
          <button className="btn-primary" onClick={openCreate}>
            <Plus size={14} /> Nueva Regla
          </button>
        )}
      </div>

      {!isAdmin && (
        <div style={{ background: 'rgba(6,182,212,0.05)', border: '1px solid rgba(6,182,212,0.2)', borderRadius: '8px', padding: '12px 16px', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>
          ℹ️ Modo solo lectura — Solo administradores pueden crear o modificar reglas.
        </div>
      )}

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
        {[
          { label: 'Total Reglas',    value: rules.length,                         color: '#06b6d4' },
          { label: 'Activas',         value: rules.filter(r => r.enabled).length,  color: '#4ade80' },
          { label: 'Inactivas',       value: rules.filter(r => !r.enabled).length, color: '#484f58' },
          { label: 'Críticas',        value: rules.filter(r => r.severity === 'CRITICAL').length, color: '#ef4444' },
        ].map(({ label, value, color }) => (
          <div key={label} className="stat-card">
            <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: '26px', color, lineHeight: 1 }}>{value}</div>
            <div style={{ fontSize: '12px', color: '#8b949e', marginTop: '4px' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="panel">
        <div className="panel-header">
          <span style={LABEL_SM}>Reglas Configuradas</span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>{rules.length} reglas</span>
        </div>
        {loading
          ? <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: '#484f58' }}>Cargando...</div>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #30363d' }}>
                    {['Nombre', 'Métrica', 'Condición', 'Duración', 'Severidad', 'Aplica a', 'Estado', ...(isAdmin ? ['Acciones'] : [])].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 400, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rules.length === 0
                    ? <tr><td colSpan={isAdmin ? 8 : 7} style={{ padding: '32px', textAlign: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#484f58' }}>Sin reglas configuradas</td></tr>
                    : rules.map(r => (
                      <tr key={r.id} style={{ borderBottom: '1px solid rgba(48,54,61,0.5)', transition: 'background 0.15s', opacity: r.enabled ? 1 : 0.55 }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(28,35,51,0.5)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <td style={{ padding: '10px 14px' }}>
                          <div style={{ fontSize: '13px', color: '#e6edf3', fontWeight: 500 }}>{r.name}</div>
                          {r.description && <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: '#484f58', marginTop: '1px' }}>{r.description}</div>}
                        </td>
                        <td style={MC('#22d3ee')}>{r.metricType}</td>
                        <td style={MC()}>{r.operator} {r.threshold?.toLocaleString()}</td>
                        <td style={MC('#8b949e')}>{r.durationSec}s</td>
                        <td style={{ padding: '10px 14px' }}><span className={SBADGE[r.severity] ?? 'badge-info'}>{r.severity}</span></td>
                        <td style={MC('#8b949e')}>{r.appliesTo}</td>
                        <td style={{ padding: '10px 14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <div className={r.enabled ? 'dot-online' : 'dot-offline'} />
                            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: r.enabled ? '#4ade80' : '#484f58' }}>
                              {r.enabled ? 'Activa' : 'Inactiva'}
                            </span>
                          </div>
                        </td>
                        {isAdmin && (
                          <td style={{ padding: '10px 14px' }}>
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <button onClick={() => handleToggle(r)} className="btn-ghost" style={{ padding: '4px 8px' }} title={r.enabled ? 'Desactivar' : 'Activar'}>
                                {r.enabled ? <ToggleRight size={14} color="#4ade80" /> : <ToggleLeft size={14} color="#484f58" />}
                              </button>
                              <button onClick={() => openEdit(r)} className="btn-ghost" style={{ padding: '4px 8px' }} title="Editar">
                                <Edit size={13} color="#06b6d4" />
                              </button>
                              <button onClick={() => handleDelete(r)} className="btn-ghost" style={{ padding: '4px 8px' }} title="Eliminar">
                                <Trash2 size={13} color="#ef4444" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))
                  }
                </tbody>
              </table>
            </div>
          )
        }
      </div>

      {modal && <RuleModal rule={editing} onClose={closeModal} onSaved={load} />}
    </div>
  )
}

const MC = (color) => ({ padding: '10px 14px', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: color ?? '#e6edf3', whiteSpace: 'nowrap' })
