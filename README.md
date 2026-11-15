# er derby

Simulatore statico Roma–Lazio: una partita ogni cinque minuti, 90 secondi di diretta e 210 secondi di postpartita/attesa. Gli spettatori possono esplorare quote, cronaca, statistiche, rose e archivio; non possono alterare il gioco.

## Apertura e sviluppo

Aprire `index.html` nel browser: funziona anche con `file://`, senza server, installazioni o connessione. Script, dati e stemmi sono locali; i caratteri sono quelli di sistema. In alternativa `npm start` avvia un server su `http://127.0.0.1:4173` (richiede Python 3). Node serve soltanto per i test; Python per rigenerare dati e pacchetto.

```sh
npm test
npm run data
npm run build
```

`dist/` contiene l’intero sito distribuibile su qualsiasi hosting statico, GitHub Pages compreso. Può essere ospitata anche la cartella sorgente. `.openai/hosting.json` contiene l’identità per Sites; non contiene credenziali. Nessuna dipendenza JavaScript di produzione o compilazione.

## Contratti e architettura

- `index.html`, `style.css`: struttura accessibile, layout responsive, campo schematico e modali native.
- `data/dataset.json`: export leggibile, 24 squadre, rose documentate, 184 risultati e istogramma dei punteggi. `data/dataset.js` espone lo stesso oggetto come `window.DERBY_DATA`, evitando fetch e restrizioni CORS con `file://`.
- `scripts/build_data.py`: selezione esplicita degli undici e validazione contro gli estratti delle fonti. Asserisce 11 titolari, un portiere, cinque riserve distinte, moduli validi e conteggio dell’archivio.
- `engine.js`: motore puro esposto come `globalThis.DerbyEngine`, utilizzabile anche da Node senza DOM. `createEngine(data)` restituisce `pairing(slot)`, `probabilities(pair)`, `distribution(pair)`, `markets(pair)`, `createMatch(slot)` e `snapshot(match, elapsedMs)`.
- `app.js`: rendering della partita corrente, aggiornamento ogni 250 ms, navigazione via hash, quote prepartita, schede e archivio. Non conserva un contatore temporale incrementale: rilegge l’orologio a ogni tick.
- `tests/engine.test.js`: determinismo fra contesti JS indipendenti, bilanciamento del calendario, calibrazione, quote, confini temporali e coerenza su 5.000 partite.

## Tempo e determinismo

L’epoca fissa è il 1 gennaio 2025 UTC; `slot = floor((Date.now() - epoch) / 300000)`. L’offset nel ciclo determina la fase. I primi 43 secondi rappresentano il primo tempo, i successivi quattro l’intervallo, gli ultimi 43 il secondo tempo. A 90 secondi arriva il triplice fischio; a 300 parte il prossimo derby.

Ogni blocco di 144 slot contiene tutti gli abbinamenti Roma × Lazio, mescolati con Fisher–Yates e un generatore con seed. Ogni coppia appare una sola volta per blocco; stagioni adiacenti possono ripetersi contro avversari diversi. La parità dello slot determina la squadra in casa: Roma negli slot pari, Lazio negli slot dispari. Tabellone, programma, archivio, campo e quote seguono casa/trasferta. Il seed di ciascuna partita include versione e slot. Il motore non usa `Math.random()`; soltanto il rumore audio locale usa casualità non condivisa, senza influire sulla partita.

Il browser ricostruisce subito il copione completo, poi mostra solo gli eventi con `at <= elapsed`. Il risultato completo è conoscibile ispezionando il codice: in un’app statica non è possibile nasconderlo a chi controlla il proprio browser. L’interfaccia non anticipa gli esiti futuri. Non esistono denaro o scommesse.

L’ingresso a partita iniziata, il ritorno da una scheda sospesa e anche i salti di orologio portano direttamente allo slot corrente. Si richiedono orologi accurati e la medesima versione dei file per sincronizzare gli spettatori. Nessuna garanzia di sincronizzazione se il dispositivo ha un orario errato. Non c’è un service worker che possa mantenere vecchi file in cache; per un deploy usare aggiornamenti atomici dell’intero pacchetto.

## Modello e quote

Il campione storico resta 68/184 Roma, 65/184 pareggio, 51/184 Lazio. Il modello v3 conserva il 35% del vantaggio storico e mescola il restante 65% con la distribuzione speculare neutrale: target Roma 33,95%, pareggio 35,33%, Lazio 30,72%. Per ogni coppia si applica `exp(±0.018 × differenzaForza)` ai pesi di vittoria. Fattori globali vengono calibrati iterativamente affinché la media sui 144 abbinamenti sia uguale ai target. Il pareggio resta parte del modello.

Ogni punteggio ha probabilità `P(esito della coppia) × (0.85 × PstoricaRiequilibrata(punteggio | esito) + 0.15 × Ppoisson(punteggio | esito))`. La componente storica usa 67,5% del conteggio originale e 32,5% del conteggio speculare: ciò riduce anche l’asimmetria delle goleade. I parametri Poisson sono le medie gol di questo campione riequilibrato. La matrice iniziale 0–8 × 0–8 è normalizzata separatamente per vittorie Roma, pari e vittorie Lazio: nuovi punteggi restano possibili senza alterare i target 1X2. Anche le azioni non decisive vengono attribuite a ciascun club con probabilità 50%. Questo è il punteggio di partenza, non un esito finale imposto. La matrice viene poi trasformata dagli episodi e da essa si calcolano tutte le quote: 1X2, doppia chance, gol/no gol, over/under 2,5 e risultati esatti. La quota teorica è `1/P`, senza margine commerciale. Le quote sono fisse prepartita, e a fine gara il pannello passa alla partita successiva.

I marcatori sono estratti soltanto dai giocatori in campo al momento dell’azione; gli attaccanti hanno peso 7, i centrocampisti 3, i difensori 1. Gli assist non possono coincidere con il marcatore. I gol vengono distribuiti lungo il copione, le altre azioni generano parate, tiri fuori, angoli, intercetti e ammonizioni. Sono previsti due cambi per squadra (55° e 70°) e al massimo un’espulsione per incontro. Non ci sono infortuni o supplementari. Le statistiche sono conteggi dai soli eventi visibili; “attacchi sviluppati” non è possesso palla. La forza tra epoche e i pesi individuali sono stime editoriali: non costituiscono previsioni per gare reali.

Il calendario è bilanciato in aspettativa, gli esiti estratti oscillano: nessun vincolo forza la Roma a vincere più incontri in un piccolo campione. Il seed rende l’archivio ricostruibile, quindi non serve storage e non cresce la memoria col passare del tempo.

## Fonti e limiti

Vedere [data/SOURCES.md](data/SOURCES.md) e i collegamenti nella scheda di ogni squadra. L’archivio storico è congelato al 30 giugno 2025; non pretende di includere i derby successivi. Gli undici sono rappresentativi delle stagioni, non tabellini certificati di partite specifiche. L’app è indipendente dai due club; gli stemmi ufficiali sono attribuiti in `data/SOURCES.md`.

Per aggiornare i contenuti: conservare nuovi estratti con fonte e data, modificare selezione e criteri, rigenerare gli export e cambiare `version`. Rieseguire i test e distribuire tutti i file insieme. Per evolvere il modello si possono aggiungere dati individuali di presenze/gol verificati; oggi non sono utilizzati e non vengono inventati.

## Formazioni sul campo

La scheda Formazioni e i dettagli delle squadre consentono di alternare campo ed elenco. I giocatori sono disposti per `starters[].line`, con nomi e numeri documentati (in assenza del numero, la lettera di ruolo). Roma e Lazio sono contrapposte sullo stesso campo con tutti e 22 i giocatori visibili, anche su telefono. La scheda della singola squadra mantiene il proprio campo dedicato.

Per 20 stagioni, `formationInfo` contiene il conteggio dei moduli nei tabellini disponibili del solo allenatore rappresentato, considerando le competizioni ufficiali. Si sceglie il massimo, accorpando varianti con identica struttura numerica; in parità si mantiene il modulo rappresentativo. I conteggi più vecchi possono essere parziali. Per Roma 1941–42 e 1960–61 e Lazio 1957–58 e 1973–74 si dichiara una ricostruzione storica, senza inventare un primato statistico.

Gli estratti fattuali sono in `data/evidence/formations-*.json`. `scripts/research_formations.py` è uno strumento di raccolta separato (richiede requests e beautifulsoup4), non necessario per eseguire o costruire il sito. `npm run data` riutilizza gli estratti salvati, senza rete.

## Episodi e quote v3

Il risultato finale viene costruito dagli eventi, mantenendo la calibrazione 1X2. Il punteggio di partenza ha supporto 0–8; le sue reti ricevono tempi indipendenti tra il 2° e l’89°. Nel 18% degli incontri si pianifica un rosso (stessa probabilità per i due club), al 30°, 55° o 70°. Dopo il rosso, le reti di partenza della squadra in dieci hanno probabilità di sopravvivenza 0,62; l’avversaria può creare una rete aggiuntiva con probabilità `0.28 × minutiResidui / 90`. Il copione precedente non viene modificato. I due cambi hanno ciascuno una probabilità 0,06 e 0,035 di generare un gol successivo, per ogni club: sono effetti dichiarati del gioco, non statistiche storiche degli allenatori.

Il motore integra analiticamente tutti e sette gli scenari disciplinari, il diradamento binomiale dei gol e le occasioni aggiuntive. La matrice finale delle quote ha supporto 0–11 per club, con alcuni estremi congiunti impossibili. I pesi iniziali vengono corretti tramite la matrice di transizione tra esiti; il risultato atteso sui 144 abbinamenti resta circa 33,95% Roma, 35,33% pareggi, 30,72% Lazio. Le quote sono marginali prepartita: non conoscono lo scenario estratto. `createMatch(slot, overrides)` ha opzioni di test per disattivare disciplina o cambi; l’interfaccia non le espone.

Le riserve entrano nel posto tattico del giocatore sostituito. Si sceglie un uscente dello stesso ruolo quando disponibile; nessun portiere viene cambiato o espulso. I giocatori usciti non possono più segnare, assistere o difendere. I cambi appartengono a regole comuni della simulazione fantasy, anche per squadre di epoche con regolamenti diversi. `snapshot` espone soltanto rose ed eventi già visibili; le animazioni ricostruiscono posizioni da orario ed episodio, senza accumulare stato fisico o consumare casualità del motore.

## Suoni, classifiche e pagelle

`audio.js` produce una base di pubblico, cori senza parole e fischi mediante Web Audio. Non usa registrazioni o servizi esterni. L’audio è sempre spento inizialmente, richiede un gesto dell’utente e ha un volume regolabile. La scheda nascosta sospende l’audio; al rientro non vengono riprodotti gol arretrati. Le sorgenti brevi si disconnettono al termine. Il pulsante mostra un messaggio se il browser non supporta l’audio.

`dailyStandings(now)` ricostruisce solo i derby conclusi dalla mezzanotte di Roma. Gestisce giornate di 23 e 25 ore al cambio di ora; non serve storage o backend. Squadre ordinate per punti, differenza reti, gol fatti, identificativo; marcatori aggregati per nome e club, sommando le versioni storiche. La cache conserva soltanto l’ultima classifica e non cresce nel tempo.

`report(match)` calcola i voti dagli eventi: base 6, +1,05 per gol, +0,45 per assist, +0,18 per parata, +0,12 per intercetto; piccole penalità per tiri fuori, gol subiti dal portiere, gialli e rossi. Voti limitati a 3–10; meno di dieci minuti senza episodi decisivi dà s.v. Il migliore in campo usa voto, gol, assist e nome come criteri. Si tratta di pagelle simulate, disponibili solo al fischio finale, anche nell’archivio. I voti non valutano le prestazioni storiche reali.
