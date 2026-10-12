import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { getJob, runFetchJob, cancelJob, __resetStoreForTests, __setJobForTests } from "../lib/analysisStore";

// Lo store gira lato client; qui non c'è window né sessionStorage, quindi si
// verifica anche che la persistenza best-effort non faccia esplodere nulla.

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => __resetStoreForTests());

test("una chiave mai usata è idle", () => {
  assert.equal(getJob("nuova").status, "idle");
});

test("runFetchJob: running mentre gira, done col risultato alla fine", async () => {
  let resolve!: (v: number) => void;
  runFetchJob("k", () => new Promise<number>((r) => (resolve = r)), { qs: "a=1" });
  assert.equal(getJob("k").status, "running");
  resolve(42);
  await tick();
  const j = getJob<number>("k");
  assert.equal(j.status, "done");
  assert.equal(j.result, 42);
  assert.deepEqual(j.meta, { qs: "a=1" });
  assert.ok(j.finishedAt! > 0);
});

test("un errore conserva l'ultimo risultato buono", async () => {
  __setJobForTests("k", { status: "done", result: "vecchio", finishedAt: 1 });
  runFetchJob("k", () => Promise.reject(new Error("rete giù")));
  // Mentre gira, il risultato precedente resta a disposizione della pagina.
  assert.equal(getJob("k").result, "vecchio");
  await tick();
  const j = getJob("k");
  assert.equal(j.status, "error");
  assert.equal(j.error, "rete giù");
  assert.equal(j.result, "vecchio");
});

test("vale sempre l'ultima richiesta: una precedente più lenta viene ignorata", async () => {
  let slow!: (v: string) => void;
  runFetchJob("k", () => new Promise<string>((r) => (slow = r)));
  runFetchJob("k", () => Promise.resolve("nuovo"));
  await tick();
  slow("vecchio-arrivato-tardi");
  await tick();
  assert.equal(getJob("k").result, "nuovo");
});

test("cancelJob: il lavoro annullato non sovrascrive lo stato", async () => {
  let resolve!: (v: string) => void;
  runFetchJob("k", () => new Promise<string>((r) => (resolve = r)));
  cancelJob("k");
  resolve("ignorato");
  await tick();
  assert.notEqual(getJob("k").result, "ignorato");
});

test("chiavi diverse sono indipendenti", async () => {
  runFetchJob("a", () => Promise.resolve(1));
  runFetchJob("b", () => Promise.resolve(2));
  await tick();
  assert.equal(getJob("a").result, 1);
  assert.equal(getJob("b").result, 2);
});
