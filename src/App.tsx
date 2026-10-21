import { lazy, Suspense, useState } from 'react'
import { useRoom, type Role } from './useRoom'

const Viewer = lazy(() => import('./Viewer'))
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function newCode() {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), value => ALPHABET[value % ALPHABET.length]).join('')
}
function initialRoom() {
  const code = new URLSearchParams(location.hash.slice(1)).get('room')?.toUpperCase()
  return code && /^[A-HJ-NP-Z2-9]{8}$/.test(code) ? code : ''
}

export default function App() {
  const [room, setRoom] = useState(initialRoom)
  const [role, setRole] = useState<Role>(() => new URLSearchParams(location.hash.slice(1)).get('role') === 'headset' ? 'headset' : 'desktop')
  const [joined, setJoined] = useState(false)
  function join(code: string) {
    setRoom(code)
    location.hash = new URLSearchParams({ room: code, role }).toString()
    setJoined(true)
  }

  return (
    <main className="shell">
      <header className="masthead">
        <a className="brand" href="/" aria-label="WebXR Socket, home"><span className="brand-icon">◈</span> WEBXR <span>/</span> SOCKET LAB</a>
        <span className="tag">ESPERIMENTO 01</span>
      </header>
      {joined ? <Session key={room + role} room={room} role={role} onLeave={() => setJoined(false)} /> : (
        <section className="landing">
          <div className="eyebrow"><span className="dot" /> DUE DISPOSITIVI. UNO SPAZIO.</div>
          <h1>Dal tuo schermo.<br /><span>Al tuo spazio.</span></h1>
          <p className="intro">Collega PC e visore nella stessa stanza. Attiva il disegno e fai apparire un cubo nella realtà aumentata, in tempo reale.</p>
          <div className="setup">
            <div className="step-label">01 <span>Scegli il tuo dispositivo</span></div>
            <div className="role-switch">
              <button className={role === 'desktop' ? 'selected' : ''} onClick={() => setRole('desktop')}><span>▣</span><strong>Computer</strong><small>Invia i comandi</small></button>
              <button className={role === 'headset' ? 'selected' : ''} onClick={() => setRole('headset')}><span>◉</span><strong>Visore AR</strong><small>Disegna e interagisci</small></button>
            </div>
            <div className="step-label">02 <span>Collega la stanza</span></div>
            <form onSubmit={event => { event.preventDefault(); if (room.length === 8) join(room) }}>
              <label htmlFor="room">Codice stanza</label>
              <div className="join-row"><input id="room" placeholder="ABCD2345" maxLength={8} autoComplete="off" value={room} onChange={event => setRoom(event.target.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, ''))} /><button className="primary" disabled={room.length !== 8}>Collegati ↗</button></div>
            </form>
            {role === 'desktop' && <button className="text-button" onClick={() => join(newCode())}>Oppure crea una nuova stanza →</button>}
            <p className="hint">Usa lo stesso codice su entrambi i dispositivi.</p>
          </div>
          <div className="orbital" aria-hidden="true"><div className="orbit one" /><div className="orbit two" /><div className="cube-art"><i /><i /><i /></div><span className="orbit-label top">PC → WEBSOCKET</span><span className="orbit-label bottom">AR / HAND TRACKING</span></div>
        </section>
      )}
      <footer>REACT THREE FIBER <span>·</span> WEBXR <span>·</span> WEBSOCKET <span className="footer-note">Progettato per Meta Quest 3 / 3S</span></footer>
    </main>
  )
}

function Session({ room, role, onLeave }: { room: string; role: Role; onLeave: () => void }) {
  const connection = useRoom(room, role)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const connected = connection.status === 'connected'
  async function copy() {
    const url = new URL(location.href)
    url.hash = new URLSearchParams({ room, role: 'headset' }).toString()
    try { await navigator.clipboard.writeText(url.href); setCopied(true); setCopyError('') }
    catch { setCopyError('Copia il codice stanza e inseriscilo sul visore.') }
  }

  return (
    <section className="session">
      <div className="session-heading"><div><div className="eyebrow">{role === 'desktop' ? 'POSTAZIONE DI CONTROLLO' : 'POSTAZIONE AR'}</div><h1>{role === 'desktop' ? 'Il tuo spazio, connesso.' : 'Entra nello spazio.'}</h1></div><button className="secondary" onClick={onLeave}>Esci dalla stanza</button></div>
      <div className="room-bar">
        <div><small>STANZA</small><strong className="room-code">{room}</strong></div>
        <button className="secondary" onClick={copy}>{copied ? 'Link copiato ✓' : 'Copia link per il visore ↗'}</button>
        <span className={connected ? 'connection online' : 'connection'}><span className="dot" />{connected ? 'WebSocket connesso' : connection.status === 'connecting' ? 'Connessione…' : 'Riconnessione…'}</span>
      </div>
      {copyError && <p role="status" className="hint">{copyError}</p>}
      {role === 'desktop' ? (
        <div className="dashboard">
          <div className="commands">
            <button className="command-card" disabled={!connected || connection.pending} onClick={() => connection.send('draw-enable')}>
              <span className="command-number">01 / DISEGNO</span><span className="command-icon">⌁</span><strong>Attiva modalità disegno <span>↗</span></strong><p>Abilita il pinch sul visore per tracciare linee nello spazio.</p><span className="card-status">{connection.state.drawing ? '● Modalità attiva' : 'In attesa di attivazione'}</span>
            </button>
            <button className="command-card cube-card" disabled={!connected || connection.pending} onClick={() => connection.send('cube-spawn')}>
              <span className="command-number">02 / OGGETTI</span><span className="command-icon">◇</span><strong>Spawna un cubo <span>↗</span></strong><p>Fai apparire un cubo al centro della scena AR. Il visore può afferrarlo e spostarlo.</p><span className="card-status">{connection.state.cubeVersion ? '● Cubo presente · clicca per ricrearlo' : 'Nessun cubo nella scena'}</span>
            </button>
          </div>
          <aside className="status-panel"><div className="eyebrow">STATO DELLA SESSIONE</div><div className="device-row"><span>▣ Computer</span><strong>{connection.peers.desktop}</strong></div><div className="device-row"><span>◉ Visori collegati</span><strong>{connection.peers.headset}</strong></div><div className="device-row"><span>Visori in AR</span><strong className={connection.peers.ar ? 'accent' : ''}>{connection.peers.ar}</strong></div><hr /><h3>{connection.peers.ar ? 'Pronto a sperimentare.' : 'Collega il tuo visore.'}</h3><p>Apri il link nel Meta Quest Browser, collegati alla stanza e premi “Entra in AR”.</p><p>I comandi restano disponibili anche se il visore si collega in seguito.</p></aside>
        </div>
      ) : <Suspense fallback={<div className="loading">Caricamento dello spazio AR…</div>}><Viewer connection={connection} /></Suspense>}
      <div className="notice" role="status" aria-live="polite"><span className="dot" />{connection.notice || (connected ? 'Stanza pronta. I due dispositivi possono essere su reti diverse.' : 'Collegamento al server in corso…')}</div>
    </section>
  )
}
