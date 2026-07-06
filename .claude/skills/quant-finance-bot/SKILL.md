---
name: quant-finance-bot
description: Metodologia quant per lavorare sulle strategie di trading di questa repo (finance-bot). Usa questa skill OGNI VOLTA che si toccano strategie, backtest, soglie, parametri, exit rules, sizing o segnali (sentiment/scanner, Momentum RS, Index Trader, Rotazione a leva, autopilot) — anche se l'utente chiede solo "migliora la strategia", "cambia un parametro", "perché performa male" o propone una nuova regola di trading. Contiene i criteri di accettazione walk-forward, le guardie anti-overfitting e i comandi per validare empiricamente ogni modifica prima di adottarla.
---

# Quant workflow — finance-bot

Regola zero: **nessuna modifica a strategie o parametri viene adottata senza validazione empirica** con il motore di backtest del repo. Le opinioni non contano, i walk-forward sì.

## Criteri di accettazione (una modifica passa solo se…)

1. **Walk-forward multi-fold**, mai un singolo split: `folds: 5` sull'orizzonte massimo (~5 anni Yahoo, include il bear 2022). Il verdetto di un singolo split cambia segno al variare della soglia — è rumore.
2. **Peggior fold PF ≥ 0,9** (ideale ≥ 1,0) e mediana expectancy/PF sopra la baseline. Un edge vero regge in (quasi) ogni sotto-periodo.
3. **Plateau, non picco**: testa 5-7 vicini di parametro (±1 step su ogni asse). Se i vicini crollano, è overfitting; se restano solidi, adotta il centro del plateau.
4. **Griglia dichiarata in anticipo**: decidi le varianti prima di lanciare, non inseguire i risultati. Ogni config extra testata sulla stessa finestra aumenta la probabilità che il "vincitore" sia fortuna.
5. **Metriche oneste**: equity mark-to-market giornaliera (già nel motore), slippage anche sugli stop, confronto sempre contro SPY buy&hold sulla stessa finestra.

## Come eseguire esperimenti

Script `.mts` nello scratchpad (mai nel repo), import diretto dalle lib:

```ts
import { runBacktest } from "<repo>/lib/backtest";            // sentiment/tecnica
import { runMomentumBacktest } from "<repo>/lib/momentumBacktest"; // Momentum RS
import { runIndexBacktest } from "<repo>/lib/indexBacktest";  // Index Trader
import { runRotationBacktest } from "<repo>/lib/leverageRotation"; // Rotazione a leva
```

Esecuzione: `npx tsx script.mts` (ignora il warning "Unsupported environment" di yahoo-finance2). Ogni run rifetcha da Yahoo (~3-20 s); lancia le griglie in background. Per accesso DB (Turso): `set -a && source .env.local && set +a` prima di tsx.

Baseline note (2026-07, per accorgersi di regressioni):
- Momentum RS v3 default (SP500 top-80) 2021-26 → PF ~1,3, WF5 worst fold ≥1,0. `SP500_FULL` (503 titoli) NON è il default: full-period migliore (+200%) ma worst fold PF 0,4 → bocciato dal gate di robustezza.
- Rotazione `deep:true` 33y default (SSO/BIL, SMA200, isteresi 2%) → CAGR 14,6 vs SPY 10,9, DD 39,3%, 58 switch, batte SPY 6/6 WF. Ladder bocciato (CAGR 8,2). TQQQ: CAGR ~20 ma DD 87%.
- Sentiment thr70+cap3% 4,5y → PF 1,32, maxDD 19,5%.
- I fetch sono cachati su file (.cache/candles, TTL 18h): warm run ~10ms/ticker; `CANDLE_CACHE=off` per disattivare. Yahoo serve lo storico completo (SPY dal 1993), usare `adjClose` per i rendimenti total-return.
- `npm test` = 18 test deterministici sulla matematica dei motori: vanno tenuti verdi e estesi quando si tocca un motore.

## Mappa dei file

| Cosa | Dove |
|---|---|
| Scanner sentiment + gates (TECH_GATE 45, FINAL_GATE 70) | `lib/scanner.ts`, lessico in `lib/news.ts` |
| Backtest sentiment (MTM, walk-forward, risk cap) | `lib/backtest.ts` → `/api/backtest` |
| Momentum RS: segnale live / backtest v3 | `lib/momentumAnalysis.ts` / `lib/momentumBacktest.ts` |
| Index Trader (BUY congelati: `BUY_SIGNALS_FROZEN`) | `lib/indexAnalysis.ts`, `lib/indexBacktest.ts` |
| Rotazione a leva (SPY vs SMA200 → SSO/BIL) | `lib/leverageRotation.ts` → `/rotation` |
| Autopilot paper-trading (strategia in meta `autopilot_strategy`) | `lib/autopilotEngine.ts`, tick cron `/api/autopilot/tick` |
| Sizing / rischio aggregato | `lib/risk.ts` |
| Canale di regressione (z, R², trend) | `lib/regression.ts` |

## Trappole note

- **Survivorship bias**: universi (`lib/universe.ts`, `lib/indices.ts`) = liste di oggi testate sul passato. Ogni PF è ottimistico; non promettere mai i numeri del backtest come attesi live.
- **Yahoo dà ~5 anni**: il 2008/2020 non è testabile; l'evidenza lunga va cercata in letteratura, non promessa dai nostri dati.
- **Momentum stock-picking non batte SPY nel bull secolare** (misurato più volte): l'indice cap-weighted è già una strategia momentum a costo zero. Per battere SPY in assoluto → Rotazione a leva. Non riaprire questa discussione senza dati nuovi.
- **Live/backtest parity**: se cambi il segnale live, cambia i default del backtest (e viceversa) — la divergenza tra i due è stata la causa dei numeri gonfiati pre-audit.
- **Un dev server di un'altra sessione spesso occupa :3000** e Next 16 rifiuta un secondo `next dev` nella stessa dir: per verifiche usa curl con cookie di sessione (JWT HS256 firmato con `AUTH_SECRET` di `.env.local`, payload `{userId, email, name}`) oppure `next start` su altra porta dopo la build.
- L'equity dei backtest si confronta con `spyEquity` della stessa risposta, non con numeri di finestre diverse.
