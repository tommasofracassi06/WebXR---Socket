import { Suspense, useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import { createXRStore, XR, XROrigin, useXR } from '@react-three/xr'
import { Handle } from '@react-three/handle'
import { Group } from 'three'
import { HandDrawing } from './HandDrawing'
import type { useRoom } from './useRoom'

const store = createXRStore({
  offerSession: false,
  enterGrantedSession: false,
  emulate: false,
  handTracking: true,
  hand: { teleportPointer: false },
  controller: { teleportPointer: false },
  planeDetection: false,
  meshDetection: false,
  anchors: false,
  hitTest: false,
})
type Connection = ReturnType<typeof useRoom>

export default function Viewer({ connection }: { connection: Connection }) {
  const [supported, setSupported] = useState<boolean | null>(null)
  const [inAR, setInAR] = useState(false)
  const [error, setError] = useState('')
  const [entering, setEntering] = useState(false)
  const grabbed = useRef(false)
  const [locallyClearedAt, setLocallyClearedAt] = useState(-1)
  const { state, status, send, setAR } = connection
  const active = state.drawing && state.drawVersion > locallyClearedAt

  useEffect(() => {
    let mounted = true
    if (!navigator.xr) { Promise.resolve().then(() => { if (mounted) setSupported(false) }) }
    else void navigator.xr.isSessionSupported('immersive-ar').then(value => { if (mounted) setSupported(value) }).catch(() => { if (mounted) setSupported(false) })
    const unsubscribe = store.subscribe((state, previous) => {
      if (state.session !== previous.session) {
        setInAR(Boolean(state.session))
        setAR(Boolean(state.session))
      }
    })
    return () => {
      mounted = false
      unsubscribe()
      setAR(false)
      void store.getState().session?.end()
    }
  }, [setAR])

  async function enter() {
    setEntering(true)
    setError('')
    try {
      const session = await store.enterAR()
      if (!session) setError('Impossibile avviare AR. Apri il sito nel Meta Quest Browser e consenti i permessi richiesti.')
    } catch {
      setError('Avvio AR non riuscito. Verifica i permessi del browser e riprova.')
    } finally { setEntering(false) }
  }

  const clear = useCallback(() => {
    setLocallyClearedAt(state.drawVersion)
    send('draw-clear')
  }, [state.drawVersion, send])

  // Clearing is immediate in the headset; send it after reconnection if offline.
  useEffect(() => {
    if (locallyClearedAt >= 0 && state.drawing && state.drawVersion <= locallyClearedAt && status === 'connected') {
      send('draw-clear')
    }
  }, [locallyClearedAt, state.drawing, state.drawVersion, status, send])

  return (
    <div className="viewer">
      <div className="scene">
        <Canvas camera={{ position: [0, 1.4, 0.8], fov: 55 }} gl={{ alpha: true }} dpr={[1, 1.5]}>
          <XR store={store}>
            <XROrigin />
            <ambientLight intensity={1.4} />
            <directionalLight position={[2, 4, 2]} intensity={2.5} />
            {connection.state.cubeVersion > 0 && <GrabbableCube key={connection.state.cubeVersion} grabbed={grabbed} />}
            {active && <HandDrawing grabbed={grabbed} />}
            <Suspense fallback={null}><HeadsetHud active={active} online={connection.status === 'connected'} clear={clear} /></Suspense>
          </XR>
        </Canvas>
        <div className="scene-label">ANTEPRIMA DELLA SCENA · 1 UNITÀ = 1 METRO</div>
      </div>
      <div className="viewer-panel">
        <div className="eyebrow">META QUEST / AR</div>
        <h2>{inAR ? 'Sei nello spazio.' : 'Il mondo è la tua tela.'}</h2>
        <p>Entra in AR e lascia che il PC attivi il disegno o faccia apparire il cubo.</p>
        <button className="primary" disabled={supported !== true || entering || inAR || connection.status !== 'connected'} onClick={enter}>{inAR ? 'Sessione AR attiva ✓' : entering ? 'Avvio…' : 'Entra in AR ↗'}</button>
        {supported === false && <p className="error">AR non disponibile qui. Apri questo link HTTPS nel Meta Quest Browser del visore.</p>}
        {supported === null && <p>Verifica compatibilità AR…</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <hr />
        <p><strong>Disegno:</strong> {active ? 'attivo' : 'in attesa del PC'}. Unisci pollice e indice e muovi la mano. Rilascia per terminare il tratto.</p>
        <p><strong>Cubo:</strong> avvicina la mano e fai pinch per afferrarlo, spostarlo e ruotarlo. Puoi usare anche il controller.</p>
        <p>Il cubo appare al centro della scena, a circa un metro davanti all’origine AR. Un nuovo comando lo riporta lì.</p>
        {active && <button className="secondary" onClick={clear}>X · Cancella ed esci dal disegno</button>}
      </div>
    </div>
  )
}

function GrabbableCube({ grabbed }: { grabbed: RefObject<boolean> }) {
  useEffect(() => () => { grabbed.current = false }, [grabbed])
  return (
    <Handle
      position={[0, 1.2, -0.8]}
      scale={false}
      multitouch={false}
      apply={(state, target) => {
        grabbed.current = !state.last
        target.position.copy(state.current.position)
        target.quaternion.copy(state.current.quaternion)
      }}
    >
      <mesh>
        <boxGeometry args={[0.22, 0.22, 0.22]} />
        <meshStandardMaterial color="#b8f56c" roughness={0.28} metalness={0.15} />
      </mesh>
    </Handle>
  )
}

function HeadsetHud({ active, online, clear }: { active: boolean; online: boolean; clear: () => void }) {
  const group = useRef<Group>(null)
  const session = useXR(state => state.session)
  useFrame(({ camera }) => {
    if (!group.current) return
    camera.updateWorldMatrix(true, false)
    group.current.position.set(0, -0.26, -0.7).applyMatrix4(camera.matrixWorld)
    camera.getWorldQuaternion(group.current.quaternion)
  })
  if (!session) return null
  return (
    <group ref={group}>
      <Text position={[0, 0.02, 0]} fontSize={0.018} color={online ? '#c7f96b' : '#ffb477'} raycast={() => null}>
        {!online ? 'Riconnessione al PC…' : active ? 'Pinch per disegnare' : 'In attesa del PC'}
      </Text>
      {active && <mesh position={[0, -0.055, 0]} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); clear() }}>
        <boxGeometry args={[0.25, 0.065, 0.012]} />
        <meshBasicMaterial color="#7e3040" />
        <Text position={[0, 0, 0.008]} fontSize={0.019} raycast={() => null}>X · Cancella ed esci</Text>
      </mesh>}
    </group>
  )
}
