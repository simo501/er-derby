# Indicazioni per il progetto

## IMPORTANTE: versione visibile del sito

- Il contatore di versione è il testo dello `span.app-version` in `index.html`, accanto all'orario nell'intestazione. Parte da `v1`.
- Incrementarlo di uno (`v1` → `v2` → `v3`, ecc.) per ogni nuovo aggiornamento del sito destinato alla pubblicazione: funzionalità, correzioni, stile, audio o dataset.
- Incrementarlo una sola volta per ciascun insieme di modifiche pubblicato, non a ogni salvataggio, build o commit intermedio. La sola documentazione non richiede un incremento.
- Aggiornare il contatore prima della build finale e del commit di pubblicazione. Verificare che `dist/index.html` riporti lo stesso valore del sorgente.
- Mantenere la versione visibile e leggibile vicino all'orario anche su smartphone e tablet. Non usare il numero di versione del dataset come versione del sito: sono due informazioni distinte.
- Il contatore è statico: non aggiungere API GitHub, richieste di rete o dipendenze per mostrarlo.

## Verifica e pubblicazione

- `npm run build` genera il pacchetto statico in `dist/`, incluso il catalogo dei cori.
- Eseguire `npm test` quando si modifica la logica dell'applicazione.
- Eseguire push o pubblicazioni soltanto quando richiesti dall'utente; mantenere `.openai/` esclusa da Git.
