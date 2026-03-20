import { useEffect, useRef, useCallback } from 'react'

export function useWebSocket(onMessage) {
  const wsRef      = useRef(null)
  const handlerRef = useRef(onMessage)
  handlerRef.current = onMessage

  const connect = useCallback(() => {
    const ws = new WebSocket(`ws://${window.location.hostname}:8090/ws/sdn`)
    wsRef.current = ws

    ws.onopen    = () => console.log('[WS] Connected')
    ws.onmessage = (e) => {
      try { handlerRef.current(JSON.parse(e.data)) }
      catch {}
    }
    ws.onclose = () => setTimeout(connect, 3000)
    ws.onerror = (e) => console.error('[WS] Error', e)
  }, [])

  useEffect(() => {
    connect()
    return () => wsRef.current?.close()
  }, [connect])

  return wsRef
}
