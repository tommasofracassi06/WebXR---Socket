import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { createHub } from '../server/hub.mjs'
import { MemoryStore, RedisStore } from '../server/storage.mjs'

async function start(store) {
  const hub = createHub(store)
  hub.server.listen(0, '127.0.0.1')
  await once(hub.server, 'listening')
  return { ...hub, host: `127.0.0.1:${hub.server.address().port}` }
}

async function client(hub, room, role) {
  const ws = new WebSocket(`ws://${hub.host}/api/socket`, { origin: `http://${hub.host}` })
  const messages = []
  ws.on('message', value => messages.push(JSON.parse(value.toString())))
  await once(ws, 'open')
  ws.send(JSON.stringify({ type: 'join', room, role }))
  const wait = async predicate => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const index = messages.findIndex(predicate)
      if (index >= 0) return messages.splice(index, 1)[0]
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    throw new Error('Timed out waiting for message')
  }
  await wait(event => event.type === 'snapshot')
  return { ws, wait, send: payload => ws.send(JSON.stringify(payload)), messages }
}

test('PC controls the headset, rooms are isolated, clear is synchronized, duplicate spawn is idempotent', async t => {
  const store = new MemoryStore()
  // Two separate hubs emulate clients landing on different server instances.
  const first = await start(store)
  const second = await start(store)
  t.after(async () => { await first.close(); await second.close() })
  const pc = await client(first, 'ABCD2345', 'desktop')
  const headset = await client(second, 'ABCD2345', 'headset')
  const other = await client(second, 'WXYZ6789', 'headset')
  headset.send({ type: 'activity', ar: true })
  await pc.wait(event => event.type === 'snapshot' && event.peers.ar === 1)

  pc.send({ type: 'command', id: 'draw-command-1', command: 'draw-enable' })
  await headset.wait(event => event.type === 'snapshot' && event.state.drawing)
  pc.send({ type: 'command', id: 'spawn-command-1', command: 'cube-spawn' })
  await headset.wait(event => event.type === 'snapshot' && event.state.cubeVersion === 1)
  await pc.wait(event => event.type === 'ack' && event.id === 'spawn-command-1')
  pc.send({ type: 'command', id: 'spawn-command-1', command: 'cube-spawn' })
  const repeated = await pc.wait(event => event.type === 'ack' && event.id === 'spawn-command-1')
  assert.equal(repeated.state.cubeVersion, 1)

  headset.send({ type: 'command', id: 'clear-command-1', command: 'draw-clear' })
  await pc.wait(event => event.type === 'snapshot' && event.state.revision === 3 && !event.state.drawing)
  assert.deepEqual(await store.get('WXYZ6789'), { drawing: false, drawVersion: 0, cubeVersion: 0, revision: 0 })
  assert.equal(other.messages.some(event => event.state?.cubeVersion > 0), false)

  headset.ws.close()
  await once(headset.ws, 'close')
  const reconnected = await client(second, 'ABCD2345', 'headset')
  assert.equal((await store.get('ABCD2345')).cubeVersion, 1)
  reconnected.send({ type: 'command', id: 'bad-command-123', command: 'cube-spawn' })
  const rejected = await reconnected.wait(event => event.type === 'error')
  assert.equal(rejected.message, 'Comando non consentito.')
  assert.equal((await store.get('ABCD2345')).cubeVersion, 1)
})

test('rejects foreign origins and malformed messages without crashing', async t => {
  const hub = await start(new MemoryStore())
  t.after(() => hub.close())
  const foreign = new WebSocket(`ws://${hub.host}/api/socket`, { origin: 'https://other.example' })
  const error = await new Promise(resolve => foreign.on('error', resolve))
  assert.match(error.message, /403/)
  const pc = await client(hub, 'ABCD2345', 'desktop')
  pc.ws.send('{broken')
  assert.equal((await pc.wait(event => event.type === 'error')).message, 'Messaggio non valido.')
  pc.send({ type: 'command', id: 'valid-command-1', command: 'draw-enable' })
  assert.equal((await pc.wait(event => event.type === 'ack')).state.drawing, true)
})

test('real Redis synchronizes independent instances atomically', { skip: !process.env.TEST_REDIS_URL }, async t => {
  const a = new RedisStore(process.env.TEST_REDIS_URL)
  const b = new RedisStore(process.env.TEST_REDIS_URL)
  await Promise.all([a.ready, b.ready])
  const first = await start(a)
  const second = await start(b)
  t.after(async () => { await first.close(); await second.close(); await a.close(); await b.close() })
  const room = 'ABCDEFGH'
  await a.redis.del(`webxr-socket:{${room}}:state`)
  const pc = await client(first, room, 'desktop')
  const headset = await client(second, room, 'headset')
  const id = crypto.randomUUID()
  pc.send({ type: 'command', id, command: 'cube-spawn' })
  await headset.wait(event => event.type === 'snapshot' && event.state.cubeVersion === 1)
  await Promise.all([a.apply(room, 'cube-spawn', id), b.apply(room, 'cube-spawn', id)])
  assert.equal((await b.get(room)).cubeVersion, 1)
})
