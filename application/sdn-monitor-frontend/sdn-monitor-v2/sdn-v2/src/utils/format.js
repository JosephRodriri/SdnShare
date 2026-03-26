export const formatBytes = (b) => {
  if (!b || b === 0) return '0 B'
  if (b > 1e9) return `${(b / 1e9).toFixed(2)} GB`
  if (b > 1e6) return `${(b / 1e6).toFixed(2)} MB`
  if (b > 1e3) return `${(b / 1e3).toFixed(1)} KB`
  return `${b} B`
}

export const formatPps = (pps) => {
  if (!pps) return '0 pps'
  if (pps > 1000) return `${(pps / 1000).toFixed(1)}K pps`
  return `${pps} pps`
}

export const formatDuration = (detectedAt, resolvedAt) => {
  const end  = resolvedAt ? new Date(resolvedAt) : new Date()
  const diff = Math.floor((end - new Date(detectedAt)) / 1000)
  if (diff < 60)   return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ${diff % 60}s`
  return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`
}
