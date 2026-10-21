import { useCallback, useEffect, useRef, useState } from 'react'

export type Role = 'desktop' | 'headset'
export type Command = 'draw-enable' | 'draw-clear' | 'cube-spawn'
export type RoomState = { drawing: boolean; drawVersion: number; cubeVersion: number; revision: number }
type Peers = { desktop: number; headset: number; ar: number }
type Pending = { type: 'command'; command: Command; id: string }
const EMPTY: RoomState = { drawing: false, drawVersion: 0, cubeVersion: 0, revision: 0 }

export function useRoom(room: string, role: Role) {
  const [state, setState] = useState<RoomState>(EMPTY)
  const [peers, setPeers] = useState<Peers>({ desktop: 0, headset: 0, ar: 0 })
  const [status, setStatus] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting')
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState(false)
  const socket = useRef<WebSocket | null>(null)
  const ready = useRef(false)
  const activeAR = useRef(false)
  const outbox = useRef(new Map<string, Pending>())

  useEffect(() => {
    let disposed = false
    let reconnect: ReturnType<typeof setTimeout>
    let timeout: ReturnType<typeof setTimeout>
    let ackTimeout: ReturnType<typeof setTimeout>
    let delay = 500
    const commands = outbox.current
    function apply(next: RoomState) {
      if (typeof next?.revision === 'number' && typeof next.drawing === 'boolean' && Number.isSafeInteger(next.cubeVersion)) {
        setState(previous => next.revision >= previous.revision ? next : previous)
      }
    }
    function connect() {
      if (disposed) return
      const configured = import.meta.env.VITE_WS_URL as string | undefined
      const url = new URL(configured || '/api/socket', window.location.href)
      if (!configured) url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(url)
      socket.current = ws
      timeout = setTimeout(() => ws.close(), 12000)
      ws.onopen = () => ws.send(JSON.stringify({ type: 'join', room, role }))
      ws.onmessage = ({ data }) => {
        if (disposed) return
        let event
        try { event = JSON.parse(data) } catch { return }
        if (event.type === 'snapshot') {
          const first = !ready.current
          ready.current = true
          delay = 500
          clearTimeout(timeout)
          setStatus('connected')
          apply(event.state)
          setPeers(event.peers)
          if (first) {
            setNotice('')
            if (role === 'headset') ws.send(JSON.stringify({ type: 'activity', ar: activeAR.current }))
            for (const command of commands.values()) ws.send(JSON.stringify(command))
          }
        } else if (event.type === 'ack') {
          apply(event.state)
          const command = commands.get(event.id)
          commands.delete(event.id)
          setPending(commands.size > 0)
          if (command) setNotice(command.command === 'cube-spawn' ? 'Cubo creato nella scena del visore.' : command.command === 'draw-enable' ? 'Disegno attivato sul visore.' : 'Disegno cancellato.')
        } else if (event.type === 'error') {
          setNotice(event.message || 'Errore di connessione.')
          commands.clear()
          setPending(false)
        }
      }
      ws.onerror = () => ws.close()
      ws.onclose = () => {
        clearTimeout(timeout)
        ready.current = false
        if (disposed) return
        setStatus('reconnecting')
        setPeers({ desktop: 0, headset: 0, ar: 0 })
        reconnect = setTimeout(connect, delay + Math.random() * 250)
        delay = Math.min(delay * 2, 10000)
      }
    }
    connect()
    // Retrying the same id is safe: the server deduplicates commands atomically.
    ackTimeout = setInterval(() => {
      if (commands.size && ready.current && socket.current?.readyState === WebSocket.OPEN) {
        for (const command of commands.values()) socket.current.send(JSON.stringify(command))
      }
    }, 5000)
    return () => {
      disposed = true
      clearTimeout(reconnect)
      clearTimeout(timeout)
      clearInterval(ackTimeout)
      ready.current = false
      socket.current?.close()
      commands.clear()
    }
  }, [room, role])

  const send = useCallback((command: Command) => {
    if (!ready.current || socket.current?.readyState !== WebSocket.OPEN || outbox.current.size > 0) return false
    const event: Pending = { type: 'command', command, id: crypto.randomUUID() }
    outbox.current.set(event.id, event)
    socket.current.send(JSON.stringify(event))
    setPending(true)
    setNotice('Invio del comando…')
    return true
  }, [])

  const setAR = useCallback((ar: boolean) => {
    activeAR.current = ar
    if (ready.current && socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ type: 'activity', ar }))
  }, [])

  return { state, peers, status, notice, pending, send, setAR }
}
