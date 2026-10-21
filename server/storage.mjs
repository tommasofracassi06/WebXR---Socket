import { EventEmitter } from 'node:events'
import Redis from 'ioredis'

export const initialState = () => ({ drawing: false, drawVersion: 0, cubeVersion: 0, revision: 0 })
const TTL = 86400
const PRESENCE_MS = 35000
const CHANNEL = 'webxr-socket:changes:v1'
const key = (room, suffix) => `webxr-socket:{${room}}:${suffix}`

export class MemoryStore extends EventEmitter {
  rooms = new Map()
  ready = Promise.resolve()
  room(code) {
    if (!this.rooms.has(code)) this.rooms.set(code, { state: initialState(), ids: new Map(), peers: new Map(), touched: Date.now() })
    const room = this.rooms.get(code)
    room.touched = Date.now()
    return room
  }
  async get(code) { return { ...this.room(code).state } }
  async apply(code, command, id) {
    const room = this.room(code)
    const now = Date.now()
    for (const [commandId, time] of room.ids) if (time < now - TTL * 1000) room.ids.delete(commandId)
    if (!room.ids.has(id)) {
      room.ids.set(id, now)
      if (command === 'draw-enable') { room.state.drawing = true; room.state.drawVersion++ }
      if (command === 'draw-clear') room.state.drawing = false
      if (command === 'cube-spawn') room.state.cubeVersion++
      room.state.revision++
      this.emit('change', code)
    }
    return this.get(code)
  }
  async touch(code, id, peer) {
    const room = this.room(code)
    const previous = room.peers.get(id)
    room.peers.set(id, { ...peer, seen: Date.now() })
    if (!previous || previous.ar !== peer.ar) this.emit('change', code)
  }
  async remove(code, id) {
    this.room(code).peers.delete(id)
    this.emit('change', code)
  }
  async presence(code) {
    const room = this.room(code)
    for (const [id, peer] of room.peers) if (peer.seen < Date.now() - PRESENCE_MS) room.peers.delete(id)
    for (const [code, value] of this.rooms) if (value.touched < Date.now() - TTL * 1000) this.rooms.delete(code)
    return countPeers([...room.peers.values()])
  }
  async close() {}
}

function countPeers(peers) {
  return {
    desktop: peers.filter(p => p.role === 'desktop').length,
    headset: peers.filter(p => p.role === 'headset').length,
    ar: peers.filter(p => p.role === 'headset' && p.ar).length,
  }
}

// State mutation, deduplication and publish are atomic across Function instances.
const APPLY = `
local existing = redis.call('GET', KEYS[1])
local state = existing and cjson.decode(existing) or {drawing=false,drawVersion=0,cubeVersion=0,revision=0}
if redis.call('SET', KEYS[2], '1', 'NX', 'EX', ARGV[3]) then
  if ARGV[1] == 'draw-enable' then state.drawing = true; state.drawVersion = state.drawVersion + 1 end
  if ARGV[1] == 'draw-clear' then state.drawing = false end
  if ARGV[1] == 'cube-spawn' then state.cubeVersion = state.cubeVersion + 1 end
  state.revision = state.revision + 1
  redis.call('SET', KEYS[1], cjson.encode(state), 'EX', ARGV[3])
  redis.call('PUBLISH', ARGV[4], ARGV[2])
end
return cjson.encode(state)
`

export class RedisStore extends EventEmitter {
  constructor(url) {
    super()
    const options = { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 8000 }
    this.redis = new Redis(url, options)
    this.subscriber = new Redis(url, options)
    // Do not log connection strings or raw Redis errors containing credentials.
    this.redis.on('error', () => {})
    this.subscriber.on('error', () => {})
    this.subscriber.on('message', (_, room) => this.emit('change', room))
    this.ready = Promise.all([this.redis.connect(), this.subscriber.connect()])
      .then(() => this.subscriber.subscribe(CHANNEL))
    this.ready.catch(() => {})
  }
  async get(room) {
    const value = await this.redis.get(key(room, 'state'))
    return value ? JSON.parse(value) : initialState()
  }
  async apply(room, command, id) {
    return JSON.parse(await this.redis.eval(APPLY, 2, key(room, 'state'), key(room, `command:${id}`), command, room, TTL, CHANNEL))
  }
  async touch(room, id, peer) {
    const peersKey = key(room, 'peers')
    const old = await this.redis.hget(peersKey, id)
    await this.redis.hset(peersKey, id, JSON.stringify({ ...peer, seen: Date.now() }))
    await this.redis.expire(peersKey, 120)
    if (!old || JSON.parse(old).ar !== peer.ar) await this.redis.publish(CHANNEL, room)
  }
  async remove(room, id) {
    await this.redis.hdel(key(room, 'peers'), id)
    await this.redis.publish(CHANNEL, room)
  }
  async presence(room) {
    const values = await this.redis.hgetall(key(room, 'peers'))
    const peers = []
    for (const value of Object.values(values)) {
      const peer = JSON.parse(value)
      if (peer.seen >= Date.now() - PRESENCE_MS) peers.push(peer)
    }
    return countPeers(peers)
  }
  async close() {
    this.redis.disconnect()
    this.subscriber.disconnect()
  }
}

export function createStore() {
  const url = process.env.REDIS_URL || process.env.KV_URL
  if (url) return new RedisStore(url)
  if (process.env.VERCEL) throw new Error('Configure REDIS_URL in Vercel before deploying.')
  return new MemoryStore()
}
