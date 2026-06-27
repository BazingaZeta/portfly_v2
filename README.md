# Finance Bot — Portfly

Piattaforma di analisi finanziaria per il mercato azionario USA. Combina segnali tecnici,
forza relativa, notizie e bot automatico in un'unica interfaccia. Dati gratuiti via Yahoo Finance.

> ⚠️ **Non è consulenza finanziaria.** I segnali sono generati da regole deterministiche su
> indicatori tecnici e sentiment lessicale. Le decisioni di investimento sono sempre tue.

---

## Avvio rapido

```bash
npm install
npm run dev
```

Apri [http://localhost:3000](http://localhost:3000) e accedi con le tue credenziali.

---

## Sezioni

### 📊 Segnali giornalieri (`/`)

La dashboard principale. Ogni giorno analizza l'intero universo di titoli USA e genera
segnali **BUY** ad alta convinzione.

**Come funziona:**
1. Per ogni titolo scarica ~1 anno di candele giornaliere e calcola gli indicatori:
   RSI 14, EMA 9/21, SMA 50, ROC 10, volume vs media, ATR 14.
2. Ogni condizione tecnica attiva aggiunge/sottrae peso. Solo i titoli sopra SMA 50
   con score ≥ 45 passano al filtro notizie.
3. Scarica headline da Yahoo Finance RSS e applica un sentiment lessicale come bonus/penalità.
4. Emette segnali con score finale ≥ 64, con **entry, target (+2.5 ATR), stop (−1.5 ATR)**,
   R/R e razionale leggibile.

**Funzionalità:**
- Auto-scansione giornaliera all'apertura dell'app (nessun click manuale)
- Ricerca per ticker o nome, filtro per settore, ordinamento per score/upside/sentiment
- Sparkline degli ultimi 40 giorni con linee target/stop su ogni card
- Badge earnings: segnalazione se la prossima data earnings è entro 7 giorni
- Filtro regime di mercato: in mercato ribassista (SPY sotto SMA 50/200) i BUY vengono penalizzati
- Position sizing suggerito: quante azioni comprare per rischiare la % impostata

---

### 💼 Portafoglio (`/track`)

Tracking delle posizioni aperte con P&L live e storico delle operazioni.

**Funzionalità:**
- P&L non realizzato aggiornato ogni 30 secondi (prezzi live da Yahoo Finance)
- Barra stop → target per ogni posizione
- **Segnali di uscita intelligenti:** trailing stop dal massimo, RSI ipercomprato, EMA che gira,
  notizie negative — con avvisi evidenziati e notifiche desktop opzionali
- Rischio aperto totale (% del capitale allo stop) con colore di allerta
- Chiusura posizione con registrazione del P&L realizzato

---

### 🎯 Index Trader (`/index`)

Analisi dei titoli che guidano un indice borsistico tramite canali di regressione lineare.
Sezione completamente isolata dal resto (API, tabella DB e logica separate).

**Come funziona:**
1. Scegli un indice: **S&P 500, Nasdaq 100 o Dow Jones 30**
2. L'app identifica i titoli che contribuiscono di più all'indice:
   peso (market cap) × rendimento a 20 giorni = "spinta"
3. Applica **canali di regressione lineare** (40 barre) a ogni leader:
   - Canale **ascendente** (pendenza > 0, R² ≥ 0.5) + forza relativa in salita → **COMPRA**
   - Stop = banda inferiore del canale, target = banda superiore
4. Filtra per forza relativa: il rapporto `prezzo_stock / ETF_indice` deve essere
   anch'esso in canale ascendente (badge RS ↗)

**Tracking:** posizioni isolate con P&L live, stop evidenziato a rosso se colpito.

**Backtest:** simulazione realistica 2 anni con validazione out-of-sample, 16 varianti
di strategia testate. Nota onesta: nessuna variante mostra un edge dimostrabile — utile
come **screener dei leader**, non come sistema automatico cieco.

---

### ⚡ Momentum RS (`/momentum`) ← **Nuova sezione**

Analisi della forza relativa basata sul **metatitolo** (approccio ispirato a portfly-python-refactor).

**Concetto chiave — il Metatitolo:**
Per ogni titolo, invece di analizzare il prezzo grezzo, calcolo il rapporto:
```
metatitolo[t] = prezzo_titolo[t] / prezzo_SPY[t]
```
Questo valore misura la performance del titolo **relativa al benchmark** giorno per giorno.
Se il metatitolo è in trend ascendente, il titolo sta battendo l'indice — è un leader reale.

**Come funziona:**
1. Scarica 2 anni di dati per SPY (benchmark) e ogni costituente dell'indice scelto
2. Per ogni titolo costruisce la serie del metatitolo allineata per data
3. Applica un **canale di regressione** (60 barre) sulla serie del metatitolo
4. Calcola il **RS Score composito**: RS_30gg × 20% + RS_90gg × 50% + RS_180gg × 30%
5. Ordina tutti i titoli per RS Score decrescente — i più alti sono i leader reali

**Segnali (dal canale del metatitolo):**
| Condizione | Segnale |
|------------|---------|
| Canale ascendente + prezzo nella zona bassa/media (z ≤ 0.5) | **COMPRA** |
| Canale ascendente + prezzo sovraesteso (z > 0.5) | **ATTENDI** |
| Canale piatto o discendente | **EVITA** |

**Stop e Target:** derivati dal canale di regressione sul prezzo grezzo (40 barre).

**Tracking:** posizioni isolate (tabella `index_trades` con prefisso `MOMENTUM_`), P&L live,
performance summary con win rate e P&L realizzato totale.

**Differenze vs Index Trader:**
- Index Trader usa il canale sul **prezzo grezzo** + RS come filtro secondario
- Momentum RS usa il canale sul **metatitolo** come segnale primario + RS come ranking
- Il ranking è per **forza relativa multi-periodo**, non per contributo di mercato cap

---

### 🤖 Autopilot (`/autopilot`)

Bot autonomo su **conto simulato** (paper trading). Gira una strategia rinomata e testata:
**dual momentum + filtro di trend** (ispirata a Faber GTAA / Antonacci) su ETF diversificati.

**Paniere ETF:** SPY, QQQ, IWM, EFA, EEM, VNQ, GLD, TLT, LQD, DBC

**Logica:** mantiene i 3 asset con momentum più alto che siano sopra la SMA 200; se nessun
asset soddisfa il criterio, va tutto in **cash** (modalità difensiva).

**Funzionamento:**
- Ribilancio **mensile automatico** + uscita anticipata se un asset rompe il trend
- Scheduler lato server (`instrumentation.ts`): ciclo ogni ~10 minuti mentre il server è attivo
- Nessun ordine reale, nessuna credenziale broker — simula e tu replichi sul tuo broker se vuoi
- Log trasparente di ogni decisione: dati → momentum → filtro trend → selezione → ordini

**Risultato onesto (backtest 5 anni):** CAGR ~15%, max drawdown ~13% vs SPY ~19.5% / drawdown ~19%.
In mercati fortemente rialzisti rende *meno* del buy-and-hold, ma con **drawdown minori** nei ribassi.
È una strategia di gestione del rischio, non una macchina da soldi.

---

### 📈 Performance (`/performance`)

Statistiche sulle operazioni chiuse registrate manualmente nel Portafoglio:
P&L realizzato totale, win rate, rendimento medio, miglior/peggior trade, storico completo.

---

### 🧪 Backtest (`/backtest`)

Testa la strategia dei Segnali giornalieri sullo storico (1–4 anni).

**Parametri regolabili:** soglia score, durata massima di hold, anni di storico, filtro regime.

**Output:** win rate, profit factor, expectancy, max drawdown, equity curve in $, CAGR,
capitale finale, slippage simulato, max posizioni concorrenti.

**Validazione out-of-sample:** taratura su un periodo, test su un periodo mai visto →
verdetto automatico (edge regge / si indebolisce / crolla). Serve a smascherare l'overfitting.

---

### 📰 Notizie (`/news`)

Feed notizie mercati, tecnologia e finanza con sentiment per titolo. Utile per contesto
qualitativo a supporto dei segnali tecnici.

---

## Gestione del rischio (position sizing)

Il pannello **Risk management** (in basso nella sidebar) salva capitale e % di rischio per trade in `localStorage`.

Ogni segnale mostra la **size suggerita**:
```
azioni = (capitale × rischio%) / (entry − stop)
```
Con costo totale e dollari a rischio per trade. Il backtest simula questa logica per equity
curve realistiche in $.

---

## Dati & persistenza

- Tutti i dati di mercato arrivano da **Yahoo Finance** (gratuito, non ufficiale)
- Le operazioni, segnali e stato del bot sono salvati in **SQLite**: `data/finance-bot.db`
- Il file DB è escluso da git (`.gitignore`). Cancellalo per ripartire da zero
- Su Fly.io il DB è su un volume persistente (`finance_data` → `/app/data`)

---

## Lingua

Interfaccia disponibile in **italiano e inglese**, selezionabile dal dropdown nel menu.
La scelta è salvata in `localStorage`.

---

## Stack tecnico

| Layer | Tecnologia |
|-------|-----------|
| Framework | Next.js (App Router) |
| UI | Tailwind CSS |
| Database | SQLite via better-sqlite3 |
| Dati di mercato | yahoo-finance2 |
| Deploy | Fly.io (Docker) |
| Auth | JWT cookie (bcrypt) |

---

## Deploy (Fly.io)

```bash
fly deploy
```

Il DB è su volume persistente. Per resettare il DB in produzione:
```bash
fly ssh console -C "rm /app/data/finance-bot.db*"
fly machine restart
```

