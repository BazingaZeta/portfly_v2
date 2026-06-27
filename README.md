# Finance Bot — Daily Signals

Piattaforma locale che ogni giorno analizza **notizie + stato tecnico** dei titoli
e suggerisce eventuali **BUY** su trend di breve, con tracking delle operazioni
e P&L live. Nessun costo: usa dati gratuiti (Yahoo Finance non ufficiale + RSS).

> ⚠️ **Non è consulenza finanziaria.** I segnali sono generati da regole
> deterministiche su indicatori tecnici e da un sentiment lessicale sulle notizie.
> Le decisioni di investimento sono tue.

## Avvio

```bash
npm install
npm run dev
```

Apri http://localhost:3000 e premi **▶ Scan giornaliera**.

## Come funziona

1. **Scan** (`lib/scanner.ts`): per ogni titolo dell'universo (`lib/universe.ts`)
   scarica ~1 anno di candele giornaliere e calcola indicatori
   (`lib/indicators.ts`): RSI 14, EMA 9/21, SMA 50, ROC 10, volume vs media, ATR.
2. **Scoring**: ogni condizione che si attiva aggiunge/sottrae peso. Solo i titoli
   sopra la SMA 50 e con score tecnico ≥ 45 passano allo step notizie.
3. **Notizie** (`lib/news.ts`): per i finalisti scarica le headline da Yahoo Finance
   RSS, calcola un sentiment lessicale e lo applica come bonus/penalità.
4. **Output**: vengono salvati i segnali con score finale ≥ 64 (alta convinzione),
   con entry, **target** (+2.5 ATR), **stop** (−1.5 ATR), R/R e razionale leggibile.

### Tarare il comportamento

In `lib/scanner.ts`:

| Costante      | Default | Effetto |
|---------------|---------|---------|
| `TECH_GATE`   | 45      | Soglia tecnica per considerare un titolo |
| `FINAL_GATE`  | 64      | Soglia finale per emettere un segnale (alza = meno segnali, più convinti) |
| `STOP_ATR`    | 1.5     | Distanza dello stop in ATR |
| `TARGET_ATR`  | 2.5     | Distanza del target in ATR |

L'universo dei titoli scansionati è in `lib/universe.ts` — aggiungi/togli ticker liberamente.

## Tracking

- **Segnali**: premi *Ho comprato* su una card per registrare l'acquisto (azioni + prezzo).
- **Portafoglio**: posizioni aperte con P&L live (prezzo aggiornato da Yahoo), e
  *Ho venduto* per chiudere una posizione e registrare il P&L realizzato.
- **Notizie**: feed generale mercati/tech/mondo con sentiment per titolo.

I prezzi delle card (riga "Ora") e il P&L del portafoglio si **aggiornano da soli
ogni 30 secondi** mentre la pagina è aperta (badge "aggiornato alle HH:MM"). Entry,
target e stop dei segnali restano fissi: sono la foto scattata al momento dello scan.

### Automazioni utili

- **Auto-scansione giornaliera**: aprendo l'app, se oggi non è ancora stata fatta
  una scansione, parte automaticamente (banner in alto). Niente click manuale.
- **Alert di uscita + notifiche desktop** (pagina Portafoglio): ogni posizione mostra
  una barra **stop → target**; quando il prezzo tocca il target o lo stop compare un
  banner "Vendi" e, se hai abilitato le notifiche, arriva un avviso desktop.
- **Performance**: pagina con **P&L realizzato, win rate, rendimento medio** e storico
  delle operazioni chiuse, per capire se i segnali funzionano.

### Index Trader (sezione isolata)

Pagina dedicata (`/index`), separata dal resto (API, tabella DB e logica proprie):
1. Scegli un **indice** (S&P 500 / Nasdaq 100 / Dow 30).
2. L'app calcola chi lo sta **spingendo di più** = peso (market cap) × movimento a
   20 giorni, e ordina i titoli per contributo.
3. Su quei leader applica **canali di regressione lineare** (40 giorni): se il canale è
   **ascendente** (pendenza positiva, R² ≥ 0.5) genera un **COMPRA**, con
   **entry/stop/target presi dal canale** (stop = banda inferiore, target = banda
   superiore). Titoli senza trend pulito → AVOID.
4. Tracking **isolato** (tabella `index_trades`) con P&L live e **stop-loss** evidenziato.

Il grafico mostra il prezzo dentro il canale di regressione (bande ±2σ).

**Forza relativa (RS):** "quanto spinge il titolo l'indice" è misurato dal rapporto
`prezzo_stock / prezzo_indice` (proxy ETF: SPY/QQQ/DIA). Se quel rapporto è in canale
ascendente, il titolo sta **battendo** l'indice → lo guida davvero. Il BUY richiede sia
canale prezzo ascendente **sia** RS in salita (badge "RS ↗").

**Backtest + ottimizzatore** (`/api/index/backtest`, `/api/index/optimize`): sim realistica
+ validazione out-of-sample. L'ottimizzatore prova **16 varianti** della strategia (zona
d'ingresso, uscita canale/ATR/trailing, qualità del trend R², filtro RS, durata) e valida
ognuna OOS.

> **Risultato onesto e definitivo:** nessuna delle 16 varianti ha un edge. **Tutte** perdono
> sul periodo completo (−5% … −64%) e **tutte** perdono in-sample. Le poche positive
> out-of-sample lo erano solo grazie al rimbalzo recente del mercato (negative in-sample =
> rumore, non skill). Persino la migliore rende meno di un buy-and-hold dell'indice.
> **Conclusione:** il timing a canali di regressione sui leader dell'indice **non ha un
> vantaggio dimostrabile**. La sezione resta utile come **screener** (quali titoli guidano
> l'indice + forza relativa), ma i segnali automatici NON vanno seguiti alla cieca — un
> avviso in-app lo dichiara apertamente.

### Gestione del rischio (position sizing)

- Pannello **Risk management** (Segnali e Backtest): capitale + % di rischio per trade,
  salvati in `localStorage`.
- Ogni card mostra la **size suggerita**: quante azioni comprare per rischiare quella %
  in base alla distanza dallo stop (`shares = capitale × rischio% / (entry − stop)`),
  con costo e $ a rischio. La quantità pre-compila il form "Ho comprato".
- Il **backtest** ora simula la size per rischio → equity curve in **$**, **CAGR**,
  **max drawdown realistico** e capitale finale (non più "1 unità/trade").
- Il **Portafoglio** mostra il **rischio aperto** totale (allo stop) come % del capitale,
  con colore di allerta.

> Nota: il backtest somma i trade in sequenza per data di uscita e **non limita il rischio
> concorrente** (in live non puoi rischiare l'1% su 10 posizioni aperte insieme con un solo
> conto). Il CAGR è quindi ottimistico; il "rischio aperto" del portafoglio serve proprio a
> tenere sotto controllo questo limite nel mondo reale.

### Autopilot (bot automatico su conto simulato)

Sezione isolata `/autopilot`: un **motore autonomo** che gira una strategia **rinomata e
testata** — **dual momentum + filtro di trend** (Faber GTAA / Antonacci) su un paniere di
ETF (SPY, QQQ, IWM, EFA, EEM, VNQ, GLD, TLT, LQD, DBC). Tiene i 3 asset più forti che sono
anche sopra la SMA200; altrimenti va in **cash** (modalità difensiva). Ribilancio mensile +
uscita anticipata se un asset rompe il trend.

- **Pilota automatico**: uno scheduler lato server (`instrumentation.ts`) esegue un ciclo
  **ogni 10 minuti finché il server è aperto** — il bot opera da solo, senza click. Si ferma
  alla chiusura del server e riparte da solo alla riaccensione (lo stato è su DB). Reset = stop.
- **Conto SIMULATO (paper)**: analizza, compra e vende **da solo** su un portafoglio virtuale.
  Nessun ordine reale, nessuna credenziale — per scelta e per sicurezza. Repliché tu gli
  ordini sul broker se vuoi.
- **Flow dati & decisioni** trasparente (log: dati scaricati → momentum → filtro trend →
  selezione → ordini), **P&L live**, posizioni con peso, equity curve.
- **Backtest 5 anni vs S&P 500** integrato. Risultato onesto: CAGR ~15% e **drawdown ~13%**
  contro SPY ~19.5% / drawdown ~19%. In un mercato fortemente rialzista rende *meno* del
  buy-and-hold, ma con **drawdown più bassi** (protegge nei ribassi andando in cash). È una
  strategia di **gestione del rischio**, non una macchina da soldi.

### Validazione & qualità dei segnali

- **Backtest** (pagina dedicata): testa le regole tecniche + le uscite ATR sullo
  storico (1–4 anni) e mostra **win rate, profit factor, expectancy, max drawdown**
  ed equity curve. Solo tecnico (il sentiment notizie non è replicabile storicamente).
  Parametri regolabili: soglia score, hold massimo, lookback, filtro regime on/off.
  Serve a sapere se la strategia ha davvero un edge **prima** di rischiare capitale.
- **Filtro di regime di mercato**: ogni scan classifica SPY (rialzista/neutro/ribassista
  su SMA 50/200). In mercato ribassista i BUY vengono penalizzati; un banner mostra il
  contesto. "Non combattere il trend di fondo."
- **Filtro earnings**: per i finalisti viene recuperata la prossima data earnings; se è
  entro 7 giorni il segnale è penalizzato e segnalato con un badge (evento binario, non
  un trend pulito).
- **Uscite intelligenti** (Portafoglio): oltre a target/stop statici, le posizioni
  vengono ri-valutate (trailing stop dal massimo, RSI ipercomprato, EMA che gira,
  notizie negative) con avvisi e notifiche desktop.

Il backtest è **realistico**: simula un singolo conto con **max posizioni concorrenti**,
vincolo di cassa, **gap che bucano lo stop**, **slippage** e commissioni. Mostra quante
operazioni sono state davvero eseguite vs quante segnalate (il resto saltato per limiti di
conto), equity in $, CAGR e drawdown veri.

Include la **validazione out-of-sample**: taratura su un periodo, test su un periodo mai
usato, con verdetto automatico (regge / si indebolisce / crolla). Serve a smascherare
l'overfitting. *Risultato onesto al momento: con le soglie attuali l'edge **non regge
fuori campione** — va trattato come non dimostrato.*

### Esplorazione dei segnali

Sulla pagina Segnali: **logo aziendale** su ogni card (con fallback a monogramma se il
logo non carica), **ricerca testuale** (ticker o nome), **filtro per categoria/settore**
(Tech, Finanza, Salute, Consumi, …) e **ordinamento** (score, potenziale al target,
sentiment, variazione live, ticker). I loghi arrivano da CDN pubbliche keyed per ticker.

Ogni card mostra una **sparkline** degli ultimi 40 giorni con le linee tratteggiate di
target (verde) e stop (rosso), e il prezzo live come ultimo punto. Le righe del
Portafoglio hanno una sparkline con la linea del costo medio.

## Dati

I dati (raccomandazioni + operazioni) sono salvati in SQLite locale: `data/finance-bot.db`
(escluso da git). Cancellalo per ripartire da zero.

## Lingua (i18n)

L'interfaccia è disponibile in **italiano e inglese**, selezionabili dal **dropdown
lingua** nel menu (in basso nella sidebar). La scelta è salvata in `localStorage`.
Tradotta tutta la UI statica (menu, titoli, pulsanti, controlli, tabelle, banner, modali).

Restano in italiano i testi **generati dal backend** (il razionale "Perché?" dei segnali,
i messaggi degli alert/uscite, i messaggi di avanzamento dello scan); i titoli delle
notizie sono in inglese perché arrivano così dalle fonti. Tradurre anche quelli richiede
un refactor che faccia emettere al backend dei codici invece del testo.

## Note

Yahoo Finance è una fonte non ufficiale e può cambiare/rate-limitare. Se uno scan
restituisse pochi dati, riprova. Per dati affidabili in futuro si possono collegare
provider con API key (Polygon, Finnhub, ecc.) sostituendo `lib/marketData.ts`.
