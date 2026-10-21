import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { WebSocketServer, WebSocket } from 'ws'

const ROOM = /^[A-HJ-NP-Z2-9]{8}$/
const ID = /^[a-zA-Z0-9-]{8,64}$/
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean)

export function createHub(store) {
  const clients = new Set()
  const send = (socket, payload) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload))
  }
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ service: 'WebXR Socket', transport: 'websocket' }))
  })
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 })
  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url, 'http://localhost').pathname
    const host = req.headers['x-forwarded-host'] || req.headers.host
    let validOrigin = false
    try {
      const origin = new URL(req.headers.origin)
      validOrigin = origin.host === host || ALLOWED_ORIGINS.includes(origin.origin)
    } catch { /* Reject non-browser origins. */ }
    if (pathname !== '/api/socket' || !validOrigin) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
  })

  async function snapshot(client) {
    if (!client.room) return
    const [state, peers] = await Promise.all([store.get(client.room), store.presence(client.room)])
    send(client.socket, { type: 'snapshot', state, peers })
  }
  function broadcast(room) {
    for (const client of clients) {
      if (client.room === room) void snapshot(client).catch(() => send(client.socket, { type: 'error', message: 'Sincronizzazione non disponibile. Riprova.' }))
    }
  }
  store.on('change', broadcast)

  wss.on('connection', socket => {
    const client = { socket, id: randomUUID(), room: null, role: null, ar: false, alive: true }
    clients.add(client)
    let queue = Promise.resolve()
    let messages = 0
    let windowStart = Date.now()
    const joinTimeout = setTimeout(() => { if (!client.room) socket.close(1008, 'Join required') }, 10000)
    joinTimeout.unref()
    socket.on('error', () => { })
    socket.on('pong', () => { client.alive = true })
    socket.on('message', (raw, binary) => {
      if (Date.now() - windowStart > 10000) { messages = 0; windowStart = Date.now() }
      if (++messages > 30 || binary) { socket.close(1008, 'Invalid traffic'); return }
      queue = queue.then(async () => {
        let event
        try { event = JSON.parse(raw.toString()) } catch { throw new Error('Messaggio non valido.') }
        if (!event || typeof event !== 'object') throw new Error('Messaggio non valido.')
        await store.ready
        if (socket.readyState !== WebSocket.OPEN) return
        if (event.type === 'join') {
          if (client.room || !ROOM.test(event.room) || !['desktop', 'headset'].includes(event.role)) throw new Error('Stanza o ruolo non valido.')
          client.room = event.room
          client.role = event.role
          clearTimeout(joinTimeout)
          await store.touch(client.room, client.id, { role: client.role, ar: client.ar })
          await snapshot(client)
        } else if (!client.room) {
          throw new Error('Entra prima in una stanza.')
        } else if (event.type === 'activity' && client.role === 'headset') {
          client.ar = event.ar === true
          await store.touch(client.room, client.id, { role: client.role, ar: client.ar })
        } else if (event.type === 'command') {
          const allowed = client.role === 'desktop' ? ['draw-enable', 'cube-spawn'] : ['draw-clear']
          if (!allowed.includes(event.command) || !ID.test(event.id)) throw new Error('Comando non consentito.')
          const state = await store.apply(client.room, event.command, event.id)
          send(socket, { type: 'ack', id: event.id, state })
        } else {
          throw new Error('Messaggio non valido.')
        }
      }).catch(error => {
        const message = ['Messaggio non valido.', 'Stanza o ruolo non valido.', 'Entra prima in una stanza.', 'Comando non consentito.'].includes(error.message)
          ? error.message : 'Servizio di sincronizzazione non disponibile.'
        send(socket, { type: 'error', message })
      })
    })
    socket.on('close', () => {
      clearTimeout(joinTimeout)
      clients.delete(client)
      // Wait for an in-flight join before removing its presence.
      void queue.finally(() => {
        if (client.room) return store.remove(client.room, client.id)
      }).catch(() => { })
    })
  })

  const timer = setInterval(() => {
    for (const client of clients) {
      if (!client.alive) { client.socket.terminate(); continue }
      client.alive = false
      client.socket.ping()
      if (client.room) {
        void store.touch(client.room, client.id, { role: client.role, ar: client.ar })
          .then(() => snapshot(client))
          .catch(() => client.socket.close(1013, 'Storage unavailable'))
      }
    }
  }, 10000)
  timer.unref()
  async function close() {
    clearInterval(timer)
    store.off('change', broadcast)
    for (const client of clients) client.socket.terminate()
    await new Promise(resolve => wss.close(resolve))
    if (server.listening) await new Promise(resolve => server.close(resolve))
  }
  return { server, close }
}
