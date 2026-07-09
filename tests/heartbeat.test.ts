/**
 * Test deterministici sulla decisione di heartbeat (logica pura, nessuna rete).
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { heartbeatDecision } from "../lib/heartbeat";

const NOW = new Date("2026-07-09T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

test("bot mai girato (appena avviato) → non stantio, nessun alert", () => {
  const d = heartbeatDecision(null, null, NOW);
  assert.equal(d.stale, false);
  assert.equal(d.alert, false);
});

test("ultimo run recente (12h) → non stantio", () => {
  const d = heartbeatDecision(hoursAgo(12), null, NOW);
  assert.equal(d.stale, false);
  assert.equal(d.alert, false);
  assert.equal(d.hoursSinceRun, 12);
});

test("run più vecchio di 36h e mai allertato → alert", () => {
  const d = heartbeatDecision(hoursAgo(40), null, NOW);
  assert.equal(d.stale, true);
  assert.equal(d.alert, true);
  assert.equal(d.hoursSinceRun, 40);
});

test("stantio ma già allertato 2h fa → niente ri-alert (anti-spam)", () => {
  const d = heartbeatDecision(hoursAgo(40), hoursAgo(2), NOW);
  assert.equal(d.stale, true);
  assert.equal(d.alert, false);
});

test("stantio e ultimo alert più vecchio di 24h → ri-alert", () => {
  const d = heartbeatDecision(hoursAgo(72), hoursAgo(25), NOW);
  assert.equal(d.stale, true);
  assert.equal(d.alert, true);
});
