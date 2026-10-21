import { createHub } from './hub.mjs'
import { createStore } from './storage.mjs'
const store = createStore()
await store.ready
const hub = createHub(store)
const port = Number(process.env.PORT || 3001)
hub.server.listen(port, '127.0.0.1', () => console.log(`WebSocket server: http://127.0.0.1:${port}/api/socket`))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  await hub.close()
  await store.close()
  process.exit(0)
})
