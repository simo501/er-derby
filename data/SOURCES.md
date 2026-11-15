# Dati e provenienza

Snapshot del simulatore `capitale-v1`. Raccolta: 15 novembre 2026. Limite temporale dei risultati: 30 giugno 2025. Nessun aggiornamento di rete durante il funzionamento.

## Risultati del derby

Fonte: [Derby della Capitale, Official match results](https://en.wikipedia.org/wiki/Derby_della_Capitale#Official_match_results), con [cronologia dei contributori](https://en.wikipedia.org/w/index.php?title=Derby_della_Capitale&action=history). Estratto consultato conservato in `evidence/derbies.txt`.

184 incontri giocati: 68 vittorie Roma, 65 pareggi, 51 vittorie Lazio. Includiamo campionato e Coppa Italia dal dicembre 1929; escludiamo amichevoli, tornei bellici, gare sospese poi rigiocate e il risultato a tavolino del 7 settembre 1969. La partita di Coppa Italia del 25 aprile 1962 è registrata 0–0, senza trasformare il successo ai rigori in una vittoria. Per questo i nostri totali differiscono dai riepiloghi che includono risultati assegnati o rigori. Nel campione selezionato non ci sono punteggi decisi da gol nei supplementari.

I risultati sono normalizzati sempre nell’ordine Roma–Lazio, anche quando la Lazio era in casa. `home` conserva il club formalmente ospitante. Il modello non applica un bonus casa: gli abbinamenti sono virtuali nello stesso stadio.

## Rose e undici

24 rose, 12 per club. Ogni oggetto squadra in `dataset.json` include il collegamento alla voce stagionale consultata (`source`); `evidence/<club>-<anno>.txt` conserva l’estratto utilizzato. I contributori sono accessibili tramite la cronologia di ogni voce. I nomi e le categorie P/D/C/A sono normalizzati dalla sezione Rosa. Un numero assente resta `null`: non inventiamo numeri di maglia per le vecchie stagioni.

Gli undici, i moduli, i cinque nomi della panchina e la forza di squadra sono selezioni editoriali. L’app non afferma che ogni undici corrisponda a una specifica partita storica. La rosa documentata può includere trasferimenti e giovani senza presenze; le riserve sono consultabili ma non entrano in campo. I ruoli tattici dell’undici possono differire dalle categorie generiche della fonte (per esempio terzini impiegati come quinti o Di Bartolomei come libero).

Attenzione alle competizioni a cavallo di annata: Roma 1960–61 è la rosa del campionato, senza gli acquisti dell’estate 1961 che la fonte elenca separatamente per le finali della Coppa delle Fiere; Lazio 1957–58 è la rosa della stagione in cui iniziò la Coppa Italia 1958, non l’undici della finale di settembre. Gli allenatori indicati sono quelli dell’epoca rappresentata, anche quando si sono avvicendati nel corso dell’annata.

Riscontri ufficiali per il contesto storico:

- [AS Roma: storia del club](https://www.asroma.com/en/club/history/a-brief-history-of-as-roma)
- [AS Roma: albo d’oro e rosa dello scudetto 2000–01](https://www.asroma.com/en/club/history/honours)
- [AS Roma: l’undici del 14 giugno 1942](https://www.asroma.com/it/notizie/51688/il-14-giugno-del-1942-il-primo-scudetto-della-roma)
- [AS Roma: la formazione del 2001](https://www.asroma.com/en/news/58627/matchday-revisited-scudetto-celebrations-in-2001)
- [S.S. Lazio: storia del club](https://www.sslazio.it/it/club/storia-del-club/storia)
- [S.S. Lazio: leggende](https://www.sslazio.it/it/club/leggende)
- [Lazio Museum: 1973–74](https://www.sslaziomuseum.com/stagioni/1973-1974/)

## Dati reali e stime

Il motore usa i risultati effettivi per le frequenze 1X2 e per i punteggi condizionati all’esito. Non usa statistiche individuali storiche per assegnare i gol: i pesi di ruolo (attaccanti 7, centrocampisti 3, difensori 1) sono convenzioni del gioco. La forza delle stagioni è una stima editoriale, non un dato estratto dalle fonti. Azioni, assist, tiri e cartellini sono inventati dal simulatore e poi conteggiati coerentemente.

## Riproduzione e attribuzione

`python3 scripts/build_data.py` rigenera entrambi gli export dagli estratti inclusi e dalle selezioni esplicite nello script. Non scarica le fonti: un aggiornamento richiede una nuova raccolta e una nuova versione del dataset. Dopo cambiamenti al motore o ai dati va cambiato `version`, per non presentare vecchie e nuove simulazioni come identiche.

Gli estratti testuali di Wikipedia, adattati rimuovendo navigazione, riferimenti numerici e markup, sono attribuiti ai contributori delle rispettive pagine e distribuiti secondo [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Le URL originali sono in ciascun estratto. Questa attribuzione riguarda i materiali tratti da Wikipedia; le valutazioni editoriali sono originali del progetto.

Il sito usa esclusivamente font di sistema, senza font remoti o file di caratteri aggiuntivi.

Stemmi ufficiali dei club (marchi dei rispettivi titolari), inclusi localmente per evitare richieste esterne:

- AS Roma: [FootyLogos, stemma corrente](https://www.footylogos.com/logos/roma), file `https://www.footylogos.com/downloads/logo/roma-logo-footylogos.svg` (credito: FootyLogos.com).
- S.S. Lazio: [sito ufficiale](https://www.sslazio.it/), file `https://www.sslazio.it/images/logo.png`.

La grafica si ispira alle curve e alle fanzine del tifo romano. Non è un prodotto ufficiale dei club o della Lega Serie A.
