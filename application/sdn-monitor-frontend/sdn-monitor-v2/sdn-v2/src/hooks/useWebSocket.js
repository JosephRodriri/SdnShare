import { useEffect, useRef, useCallback } from 'react'

export function useWebSocket(onMessage) {
  const wsRef      = useRef(null)
  const handlerRef = useRef(onMessage)
  handlerRef.current = onMessage

  const connect = useCallback(() => {
    const ws = new WebSocket(`ws://${window.location.hostname}:8090/ws/sdn`)
    wsRef.current = ws

    ws.onopen    = () => console.log('[WS] Conectado al SDN Monitor')
    ws.onmessage = (e) => {
      try { handlerRef.current(JSON.parse(e.data)) }
      catch { /* ignorar mensajes malformados */ }
    }
    ws.onclose = () => {
      console.log('[WS] Desconectado — reconectando en 3s...')
      setTimeout(connect, 3000)
    }
    ws.onerror = (err) => console.error('[WS] Error:', err)
  }, [])

  useEffect(() => {
    connect()
    return () => wsRef.current?.close()
  }, [connect])

  return wsRef
}
