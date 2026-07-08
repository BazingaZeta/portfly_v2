/**
 * Stato del mercato USA nel fuso America/New_York. Istanti espressi in UTC per
 * verificare la conversione (incluso il passaggio EST/EDT). Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { usMarketStatus, nextMarketOpen, nextMarketClose } from "../lib/marketHours";

// Inverno (EST = UTC-5). 2024-01-08 è lunedì.
test("inverno EST: sessione regolare a metà giornata", () => {
  // 15:00 UTC = 10:00 ET
  assert.equal(usMarketStatus(new Date("2024-01-08T15:00:00Z")).session, "regular");
  assert.equal(usMarketStatus(new Date("2024-01-08T15:00:00Z")).open, true);
});

test("inverno EST: apertura alle 9:30 ET, chiusura alle 16:00 ET", () => {
  // 14:30 UTC = 9:30 ET → apre
  assert.equal(usMarketStatus(new Date("2024-01-08T14:30:00Z")).session, "regular");
  // 14:29 UTC = 9:29 ET → pre-market
  assert.equal(usMarketStatus(new Date("2024-01-08T14:29:00Z")).session, "pre");
  // 21:00 UTC = 16:00 ET → after-hours
  assert.equal(usMarketStatus(new Date("2024-01-08T21:00:00Z")).session, "post");
});

test("notte europea = mercato chiuso", () => {
  // 08:00 UTC = 03:00 ET (prima del pre-market delle 4:00)
  const s = usMarketStatus(new Date("2024-01-08T08:00:00Z"));
  assert.equal(s.session, "closed");
  assert.equal(s.open, false);
});

test("weekend = chiuso anche in orario di borsa", () => {
  // Sabato 2024-01-06, 15:00 UTC
  assert.equal(usMarketStatus(new Date("2024-01-06T15:00:00Z")).open, false);
  assert.equal(usMarketStatus(new Date("2024-01-06T15:00:00Z")).session, "closed");
});

test("estate EDT (ora legale USA): conversione corretta", () => {
  // 2024-07-08 lunedì, EDT = UTC-4. 13:45 UTC = 9:45 ET → regolare
  assert.equal(usMarketStatus(new Date("2024-07-08T13:45:00Z")).session, "regular");
  // 13:00 UTC = 9:00 ET → pre-market
  assert.equal(usMarketStatus(new Date("2024-07-08T13:00:00Z")).session, "pre");
});

test("nextMarketOpen: dal weekend salta a lunedì 9:30 ET", () => {
  // Sabato → lunedì 2024-01-08 09:30 EST = 14:30 UTC
  const open = nextMarketOpen(new Date("2024-01-06T15:00:00Z"));
  assert.equal(open.toISOString(), "2024-01-08T14:30:00.000Z");
});

test("nextMarketOpen: prima dell'apertura = stessa giornata", () => {
  // Lunedì 03:00 ET → oggi 14:30 UTC
  const open = nextMarketOpen(new Date("2024-01-08T08:00:00Z"));
  assert.equal(open.toISOString(), "2024-01-08T14:30:00.000Z");
});

test("nextMarketOpen: durante la sessione = apertura del giorno dopo", () => {
  // Lunedì 10:00 ET → martedì 2024-01-09 14:30 UTC
  const open = nextMarketOpen(new Date("2024-01-08T15:00:00Z"));
  assert.equal(open.toISOString(), "2024-01-09T14:30:00.000Z");
});

test("nextMarketOpen: estate EDT usa l'offset giusto", () => {
  // Venerdì sera → lunedì 2024-07-08 09:30 EDT = 13:30 UTC
  const open = nextMarketOpen(new Date("2024-07-05T23:00:00Z"));
  assert.equal(open.toISOString(), "2024-07-08T13:30:00.000Z");
});

test("nextMarketClose: in sessione = 16:00 ET di oggi, altrimenti null", () => {
  // Lunedì 10:00 ET → chiusura 21:00 UTC
  assert.equal(nextMarketClose(new Date("2024-01-08T15:00:00Z"))?.toISOString(), "2024-01-08T21:00:00.000Z");
  // Fuori sessione → null
  assert.equal(nextMarketClose(new Date("2024-01-08T08:00:00Z")), null);
});
