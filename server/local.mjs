import { createHub } from './hub.mjs'
import { createStore } from './storage.mjs'
const store = createStore()
await store.ready
const hub = createHub(store)
const port = Number(process.env.PORT || 3001)
const host = process.env.HOST || '0.0.0.0'
hub.server.listen(port, host, () => console.log(`WebSocket server in ascolto su ${host}:${port}/api/socket`))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  await hub.close()
  await store.close()
  process.exit(0)
})