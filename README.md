# WebXR / Socket Lab

React + TypeScript + Vite + React Three Fiber + WebXR. Un PC controlla una sessione AR su Meta Quest 3/3S tramite veri WebSocket.

## Uso

1. Dal PC seleziona **Computer → Crea una nuova stanza**.
2. Sul visore apri lo stesso sito nel Meta Quest Browser, scegli **Visore AR**, inserisci il codice e premi **Entra in AR**. Puoi anche usare il link copiato dal PC.
3. Il PC ha due comandi: **Attiva modalità disegno** e **Spawna un cubo**.
4. In AR unisci pollice e indice per disegnare; rilascia per separare i tratti. La **X** cancella e disattiva il disegno, aggiornando il PC.
5. Afferra il cubo con un pinch vicino all'oggetto oppure con il controller. Durante una presa il disegno è sospeso. Il cubo resta dove lo lasci; non è prevista una simulazione fisica.

Ogni spawn ricrea un solo cubo all'origine della scena, nella posizione **[0, 1.2, -0.8] metri**. Non è il centro della stanza fisica: il progetto non richiede una scansione ambientale. L'AR mostra il passthrough, senza sfondo virtuale.

Il codice stanza è una chiave di accesso condivisa per questa demo, senza account. I comandi sono validati sul server per ruolo. Disegni e movimento del cubo restano locali al visore; il PC sincronizza modalità e spawn, senza ricevere un video o i tratti. Le sessioni non condividono ancore fisiche tra visori.

## Sviluppo

Richiede Node.js 22 o successivo.

```sh
npm install
npm run dev
```

Vite serve HTTPS sulla porta 5173 e inoltra /api/socket al server Node locale sulla porta 3001. Senza REDIS_URL viene usato uno store in memoria, adatto a un solo processo. Per la prova su LAN apri https://IP-DEL-PC:5173 e autorizza la porta nel firewall se necessario. Il certificato di sviluppo è autofirmato; sul visore è preferibile il deployment HTTPS Vercel.

```sh
npm run build
npm run lint
npm test
```

Per verificare anche Redis, imposta **TEST_REDIS_URL** a un database di test e lancia npm test. Il test usa la stanza ABCDEFGH e ne azzera lo stato; non usare un database di produzione. Senza questa variabile il test Redis è esplicitamente saltato.

## Deploy Vercel

1. Importa la repo **tommasofracassi06/WebXR---Socket** in Vercel, preset **Vite**, output **dist**, build **npm run build**.
2. Abilita **Fluid compute** nel progetto. Il server WebSocket è esportato da **api/socket.js**.
3. Collega un Redis dal Vercel Marketplace (ad esempio Upstash) e configura **REDIS_URL** con l'URL nativo TLS **rediss://…**. È supportata anche **KV_URL**. L'URL REST e il token REST non sono sostituti dell'URL nativo.
4. La variabile deve essere server-side: **non usare il prefisso VITE_**, non salvarla su GitHub. Impostala negli ambienti Production e Preview che intendi usare.
5. Pubblica e verifica PC e Quest sullo **stesso URL di produzione**. Per il test sul Quest il sito deve essere accessibile: la Deployment Protection di Vercel può richiedere un login.

Il collegamento Git Vercel aggiorna il sito a ogni push su main. I costi e i limiti dipendono dal piano Vercel e dal Redis scelto; questo repository non attiva abbonamenti.

### Perché Redis

Vercel può assegnare i due WebSocket a istanze diverse. Redis mantiene stato, presenza e Pub/Sub condivisi; le mutazioni e la deduplicazione sono atomiche con Lua. Un server che trasmette solo ai socket conservati in memoria non è sufficiente in produzione. La presenza scade dopo 35 secondi, lo stato della stanza dopo 24 ore senza comandi.

I WebSocket su Vercel hanno la durata massima delle Functions (qui 300 secondi). Il client si riconnette, rientra nella stanza, legge lo stato e ritenta i comandi non confermati con lo stesso identificatore. Gli spawn duplicati sono ignorati.

Documentazione: [WebSocket Vercel](https://vercel.com/docs/functions/websockets), [Redis Vercel](https://vercel.com/docs/redis), [WebXR](https://pmndrs.github.io/xr/docs/getting-started/introduction).

## Verifica sul dispositivo

- Collega PC e Quest, anche su reti diverse; il PC deve mostrare un visore in AR.
- Attiva il disegno dal PC, fai più pinch e controlla che i tratti siano separati.
- Premi X nel visore: i tratti spariscono e il PC indica disegno disattivato.
- Spawna il cubo, afferralo, spostalo, ruotalo e rilascialo. Spawna di nuovo per riposizionarlo.
- Interrompi e riattiva la rete del visore, poi riprova entrambi i comandi.
- Usa un altro codice stanza e verifica che i comandi non arrivino alla sessione precedente.

Il build e i test WebSocket non sostituiscono questa prova con hand tracking reale.
