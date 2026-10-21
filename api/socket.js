import { createHub } from '../server/hub.mjs'
import { createStore } from '../server/storage.mjs'

const hub = createHub(createStore())
export default hub.server
