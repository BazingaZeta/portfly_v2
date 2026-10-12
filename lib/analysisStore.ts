// Store delle analisi lato client, condiviso fra le pagine.
//
// Il problema che risolve: in Next ogni pagina è un componente che si smonta
// quando navighi altrove, e con lui lo stato — un'analisi da 80 titoli fatta
// due minuti fa spariva appena aprivi un'altra sezione. Qui i lavori vivono
// a livello di modulo, che resta caricato per tutta la sessione di navigazione:
//
//  - i risultati restano quando cambi pagina (memoria) e quando ricarichi la
//    scheda (sessionStorage, best-effort: se lo storage è pieno o disattivato
//    si perde solo la persistenza al ricaricamento);
//  - un'analisi in corso NON si interrompe se navighi via: la connessione
//    appartiene allo store, non al componente, e quando torni ritrovi il
//    progresso o il risultato;
//  - lo stato è sempre rilanciabile dai pulsanti della pagina.
//
// I componenti leggono lo stato con `useJob` (useSyncExternalStore: niente
// effetti, niente stati duplicati) e i parametri con `usePersistentState`.

import { useCallback, useSyncExternalStore } from "react";

export type JobStatus = "idle" | "running" | "done" | "error";

export interface JobState<T = unknown, P = unknown> {
  status: JobStatus;
  result?: T;
  progress?: P;
  error?: string;
  /** Timestamp dell'ultimo risultato completato. */
  finishedAt?: number;
  /** Metadati liberi del chiamante (es. i parametri con cui è stato lanciato). */
  meta?: Record<string, unknown>;
}

const IDLE: JobState = Object.freeze({ status: "idle" }) as JobState;
const STORAGE_PREFIX = "portfly:store:";
const STORAGE_INDEX = "portfly:store:index";
/** Quanti risultati tenere in sessionStorage: oltre, si scartano i più vecchi. */
const STORAGE_MAX_ENTRIES = 16;

const states = new Map<string, JobState>();
const listeners = new Map<string, Set<() => void>>();
const cancels = new Map<string, () => void>();
const hydrated = new Set<string>();

// ─── Persistenza (best-effort) ───────────────────────────────────────────────

function storageIndex(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_INDEX) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function persist(key: string, value: unknown): void {
  try {
    const idx = storageIndex().filter((k) => k !== key);
    idx.push(key);
    while (idx.length > STORAGE_MAX_ENTRIES) {
      const old = idx.shift()!;
      sessionStorage.removeItem(STORAGE_PREFIX + old);
    }
    sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
    sessionStorage.setItem(STORAGE_INDEX, JSON.stringify(idx));
  } catch {
    /* quota piena o storage disattivato: resta la cache in memoria */
  }
}

function hydrate(key: string): void {
  if (hydrated.has(key)) return;
  hydrated.add(key);
  if (typeof window === "undefined") return;
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + key);
    if (raw && !states.has(key)) states.set(key, JSON.parse(raw) as JobState);
  } catch {
    /* dato illeggibile: si riparte da zero */
  }
}

// ─── Lettura e notifiche ─────────────────────────────────────────────────────

export function getJob<T = unknown, P = unknown>(key: string): JobState<T, P> {
  hydrate(key);
  return (states.get(key) ?? IDLE) as JobState<T, P>;
}

function setJob(key: string, next: JobState): void {
  states.set(key, next);
  // In storage solo gli stati stabili: un "running" ricaricato mentirebbe,
  // perché dopo un reload la connessione non esiste più.
  if (next.status === "done" || next.status === "idle") persist(key, next);
  listeners.get(key)?.forEach((l) => l());
}

function subscribe(key: string, cb: () => void): () => void {
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  set.add(cb);
  return () => {
    set!.delete(cb);
  };
}

/**
 * Stato di un lavoro, reattivo. Sul server (e durante l'idratazione) è
 * sempre "idle", così l'HTML coincide; subito dopo arriva quello vero.
 */
export function useJob<T = unknown, P = unknown>(key: string): JobState<T, P> {
  const sub = useCallback((cb: () => void) => subscribe(key, cb), [key]);
  const snap = useCallback(() => getJob<T, P>(key), [key]);
  return useSyncExternalStore(sub, snap, () => IDLE as JobState<T, P>);
}

// ─── Lancio dei lavori ───────────────────────────────────────────────────────

/** Interrompe un lavoro in corso, lasciando l'ultimo risultato valido. */
export function cancelJob(key: string): void {
  cancels.get(key)?.();
  cancels.delete(key);
}

/**
 * Lavoro da una funzione asincrona (tipicamente un fetch JSON). Se ne parte
 * uno nuovo con la stessa chiave mentre il precedente gira, il precedente
 * viene ignorato: vale sempre l'ultimo richiesto.
 */
export function runFetchJob<T>(key: string, fn: () => Promise<T>, meta?: Record<string, unknown>): void {
  cancelJob(key);
  let stale = false;
  cancels.set(key, () => {
    stale = true;
  });
  const prev = getJob<T>(key);
  setJob(key, { ...prev, status: "running", error: undefined, progress: undefined, meta });
  fn().then(
    (result) => {
      if (stale) return;
      cancels.delete(key);
      setJob(key, { status: "done", result, finishedAt: Date.now(), meta });
    },
    (err: unknown) => {
      if (stale) return;
      cancels.delete(key);
      // In caso di errore si conserva l'ultimo risultato buono: meglio un dato
      // di qualche minuto fa che una pagina vuota.
      setJob(key, { ...getJob<T>(key), status: "error", error: err instanceof Error ? err.message : String(err) });
    }
  );
}

/**
 * Lavoro da un endpoint Server-Sent Events con eventi `progress`, `complete`
 * ed `error` (il formato usato da tutte le route di analisi del repo). La
 * connessione appartiene allo store: sopravvive al cambio di pagina.
 */
export function runSseJob<T, P = unknown>(key: string, url: string, meta?: Record<string, unknown>): void {
  cancelJob(key);
  const es = new EventSource(url);
  cancels.set(key, () => es.close());
  const prev = getJob<T, P>(key);
  setJob(key, { ...prev, status: "running", error: undefined, progress: undefined, meta });

  es.addEventListener("progress", (e) => {
    const cur = getJob<T, P>(key);
    setJob(key, { ...cur, progress: JSON.parse((e as MessageEvent).data) as P });
  });
  es.addEventListener("complete", (e) => {
    es.close();
    cancels.delete(key);
    setJob(key, { status: "done", result: JSON.parse((e as MessageEvent).data) as T, finishedAt: Date.now(), meta });
  });
  es.addEventListener("error", (e) => {
    es.close();
    cancels.delete(key);
    const data = (e as MessageEvent).data;
    let message = "Connessione interrotta";
    try {
      if (data) message = (JSON.parse(data) as { message?: string }).message ?? message;
    } catch {
      /* evento di errore di rete, senza corpo */
    }
    setJob(key, { ...getJob<T, P>(key), status: "error", error: message });
  });
}

// ─── Stato persistente semplice (parametri, schede, selezioni) ───────────────

/**
 * Come useState, ma il valore sopravvive al cambio di pagina e al reload.
 * Serve ai parametri: se tornassero ai default a ogni navigazione, non
 * corrisponderebbero più all'analisi rimasta a schermo.
 */
export function usePersistentState<T>(key: string, initial: T): [T, (v: T) => void] {
  const job = useJob<T>(`state:${key}`);
  const value = job.status === "done" && job.result !== undefined ? job.result : initial;
  const set = useCallback(
    (v: T) => setJob(`state:${key}`, { status: "done", result: v, finishedAt: Date.now() }),
    [key]
  );
  return [value, set];
}

/** Solo per i test: azzera lo store in memoria. */
export function __resetStoreForTests(): void {
  states.clear();
  listeners.clear();
  cancels.clear();
  hydrated.clear();
}

/** Solo per i test: imposta direttamente uno stato. */
export function __setJobForTests(key: string, state: JobState): void {
  setJob(key, state);
}
